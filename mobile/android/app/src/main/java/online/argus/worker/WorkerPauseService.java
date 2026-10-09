package online.argus.worker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/** Keeps a bounded pause/queue flush eligible for network access after the Activity leaves. */
public class WorkerPauseService extends Service {
    private static final String CHANNEL = "worker-pause-delivery";
    private static final int NOTIFICATION = 241;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable expire = this::stopSelf;
    private PowerManager.WakeLock wakeLock;

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Сохранение работы", NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent action = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Аргус — сохранение работы")
            .setContentText("Контроль паузы и отправка сохранённых действий")
            .setContentIntent(action).setOngoing(true).setOnlyAlertOnce(true).setSilent(true).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        else startForeground(NOTIFICATION, notification);
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ArgusWorker:pauseDelivery");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(90000);
        }
        timer.postDelayed(expire, 90000);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_NOT_STICKY; }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTimeout(int startId) { stopSelf(); }
    @Override public void onTimeout(int startId, int foregroundServiceType) { stopSelf(); }
    @Override public void onDestroy() {
        timer.removeCallbacks(expire);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
