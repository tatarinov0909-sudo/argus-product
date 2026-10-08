package online.argus.worker;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WorkerDevicePlugin.class);
        super.onCreate(savedInstanceState);
        // HTTP is only for the isolated local stand; release builds keep HTTPS-only defaults.
        if (BuildConfig.DEBUG && getBridge() != null) {
            getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                // The shared back.js handles dialogs and work screens through popstate.
                if (webView != null && webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }
}
