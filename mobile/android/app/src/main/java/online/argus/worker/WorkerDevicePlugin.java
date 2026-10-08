package online.argus.worker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.PowerManager;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintManager;
import android.print.PrintAttributes;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.UUID;

/** Device signals only. Auth, work identity and durable server commands remain in the shared client. */
@CapacitorPlugin(name = "WorkerDevice")
public class WorkerDevicePlugin extends Plugin {
    private SharedPreferences state;
    private BroadcastReceiver receiver;
    private JSONArray pending = new JSONArray();
    private String currentState = "active";
    private String departureId = "";
    private long currentAt;
    private long pauseAt;
    private volatile boolean workActive;
    private volatile boolean pendingPause;
    private final Handler deadlineHandler = new Handler(Looper.getMainLooper());
    private final Runnable screenDeadline = () -> {
        if ("screen-off".equals(currentState)) notifyListeners("lifecycle", snapshot(), true);
    };

    @Override
    public void load() {
        state = getContext().getSharedPreferences("worker-device-lifecycle", Context.MODE_PRIVATE);
        try { pending = new JSONArray(state.getString("pending", "[]")); }
        catch (JSONException ignored) { pending = new JSONArray(); }
        currentState = state.getString("state", "active");
        departureId = state.getString("departureId", "");
        currentAt = state.getLong("at", System.currentTimeMillis());
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                    depart("screen-off", pauseAt > 0 ? pauseAt : System.currentTimeMillis());
                }
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private boolean persist() {
        // Do not clear an event until JavaScript has durably saved its pause command.
        return state.edit().putString("pending", pending.toString()).putString("state", currentState)
            .putString("departureId", departureId).putLong("at", currentAt).commit();
    }

    private synchronized void depart(String kind, long at) {
        if (state == null) return;
        // A later screen-off must not replace an earlier app switch or restart its grace period.
        if (!currentState.equals("active")) return;
        currentState = kind;
        currentAt = at;
        departureId = UUID.randomUUID().toString();
        JSObject event = new JSObject();
        event.put("id", departureId);
        event.put("state", kind);
        event.put("at", at);
        pending.put(event);
        persist();
        if ("screen-off".equals(kind)) {
            // WebView timers can freeze while locked; native delivery rechecks the recorded deadline.
            deadlineHandler.postDelayed(screenDeadline, Math.max(0, at + 15000 - System.currentTimeMillis()));
        }
        notifyListeners("lifecycle", snapshot(), true);
    }

    @Override protected void handleOnPause() {
        pauseAt = System.currentTimeMillis();
        // Start while the Activity is still visible; starting at the 15s deadline is too late.
        if (workActive) {
            try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), WorkerPauseService.class)); }
            catch (RuntimeException error) { android.util.Log.w("ArgusWorker", "Pause delivery service could not start", error); }
        }
    }

    @Override protected void handleOnStop() {
        // A camera permission dialog can pause a still-visible Activity; it must not pause work.
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        depart(power != null && !power.isInteractive() ? "screen-off" : "background",
            pauseAt > 0 ? pauseAt : System.currentTimeMillis());
    }

    @Override protected synchronized void handleOnResume() {
        deadlineHandler.removeCallbacks(screenDeadline);
        stopPauseService();
        long now = System.currentTimeMillis();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject event = pending.optJSONObject(i);
            if (event != null && departureId.equals(event.optString("id")) && !event.has("resumedAt")) {
                try { event.put("resumedAt", now); } catch (JSONException ignored) { }
            }
        }
        currentState = "active";
        currentAt = now;
        departureId = "";
        pauseAt = 0;
        persist();
        notifyListeners("lifecycle", snapshot(), true);
    }

    private synchronized JSObject snapshot() {
        JSObject result = new JSObject();
        result.put("state", currentState);
        result.put("at", currentAt);
        try { result.put("pending", new JSONArray(pending.toString())); }
        catch (JSONException ignored) { result.put("pending", new JSONArray()); }
        return result;
    }

    @PluginMethod public void getLifecycle(PluginCall call) {
        call.resolve(snapshot());
    }

    @PluginMethod public synchronized void setWorkActive(PluginCall call) {
        workActive = Boolean.TRUE.equals(call.getBoolean("active", false));
        pendingPause = Boolean.TRUE.equals(call.getBoolean("pendingPause", false));
        // Pausing the UI disarms future departures but does not cancel an in-flight queue flush.
        if (!workActive && !pendingPause && pending.length() == 0) stopPauseService();
        call.resolve();
    }

    @PluginMethod public void printCurrentPage(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) { call.reject("Printing is unavailable on this device"); return; }
                manager.print("Аргус — склад", getBridge().getWebView().createPrintDocumentAdapter("Аргус — склад"),
                    new PrintAttributes.Builder().build());
                // This confirms opening the dialog, never that a physical label was printed.
                call.resolve();
            } catch (RuntimeException error) { call.reject("Cannot open printing", error); }
        });
    }

    @PluginMethod public synchronized void ackLifecycle(PluginCall call) {
        JSONArray ids = call.getArray("ids");
        if (ids == null) { call.reject("Expected lifecycle event ids"); return; }
        JSONArray remaining = new JSONArray();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject event = pending.optJSONObject(i);
            boolean acknowledged = false;
            for (int j = 0; event != null && j < ids.length(); j++) {
                if (event.optString("id").equals(ids.optString(j))) acknowledged = true;
            }
            if (!acknowledged) remaining.put(event);
        }
        JSONArray original = pending;
        pending = remaining;
        if (!persist()) { pending = original; call.reject("Cannot save lifecycle acknowledgement"); return; }
        for (int i = 0; i < ids.length(); i++) {
            if (departureId.equals(ids.optString(i))) {
                deadlineHandler.removeCallbacks(screenDeadline);
            }
        }
        if (!workActive && !pendingPause && pending.length() == 0) stopPauseService();
        call.resolve();
    }

    private void stopPauseService() {
        getContext().stopService(new Intent(getContext(), WorkerPauseService.class));
    }

    @Override protected void handleOnDestroy() {
        deadlineHandler.removeCallbacks(screenDeadline);
        stopPauseService();
        if (receiver != null) getContext().unregisterReceiver(receiver);
    }
}
