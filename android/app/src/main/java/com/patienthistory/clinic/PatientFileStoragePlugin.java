package com.patienthistory.clinic;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * File access used by the Backup / Restore screens:
 *  - saveBackup:        "Save as" dialog, writes the backup JSON where the user chooses
 *  - pickBackup:        file picker, returns the parsed backup JSON
 *  - saveSafetyBackup:  silent copy kept inside the app's own storage before restore / delete-all
 *  - openExternal:      opens a URL (WhatsApp) with the system
 */
@CapacitorPlugin(name = "PatientFileStorage")
public class PatientFileStoragePlugin extends Plugin {

    private static final long MAX_BACKUP_BYTES = 64L * 1024 * 1024;

    @PluginMethod
    public void saveBackup(PluginCall call) {
        String fileName = call.getString("fileName", "patient-record-backup.json");
        String data = call.getString("data");
        if (data == null) {
            call.reject("No backup data supplied.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "saveBackupResult");
    }

    @ActivityCallback
    private void saveBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject out = new JSObject();
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }
        try {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            Uri uri = result.getData().getData();
            try (OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (os == null) throw new IllegalStateException("Cannot open the chosen file.");
                os.write(bytes);
                os.flush();
            }
            JSObject out = new JSObject();
            out.put("cancelled", false);
            out.put("uri", uri.toString());
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Backup could not be saved: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void pickBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
        startActivityForResult(call, intent, "pickBackupResult");
    }

    @ActivityCallback
    private void pickBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject out = new JSObject();
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }
        try {
            Uri uri = result.getData().getData();
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
                if (is == null) throw new IllegalStateException("Cannot open the chosen file.");
                byte[] chunk = new byte[16 * 1024];
                int n;
                while ((n = is.read(chunk)) != -1) {
                    buffer.write(chunk, 0, n);
                    if (buffer.size() > MAX_BACKUP_BYTES) throw new IllegalStateException("The file is too large to be a backup.");
                }
            }
            String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
            JSObject backup;
            try {
                backup = new JSObject(new JSONObject(text).toString());
            } catch (Exception parseError) {
                call.reject("Please choose a Patient Record JSON backup file.");
                return;
            }
            JSObject out = new JSObject();
            out.put("cancelled", false);
            out.put("backup", backup);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Backup could not be read: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void saveSafetyBackup(PluginCall call) {
        String fileName = call.getString("fileName");
        String data = call.getString("data");
        if (fileName == null || data == null) {
            call.reject("fileName and data are required.");
            return;
        }
        // Keep only a plain file name; never allow path traversal.
        String safeName = new File(fileName).getName().replaceAll("[^A-Za-z0-9._-]", "_");
        try {
            File base = getContext().getExternalFilesDir("backups");
            if (base == null) base = new File(getContext().getFilesDir(), "backups");
            if (!base.exists() && !base.mkdirs()) throw new IllegalStateException("Cannot create the backups folder.");
            File target = new File(base, safeName);
            try (FileOutputStream fos = new FileOutputStream(target)) {
                fos.write(Base64.decode(data, Base64.DEFAULT));
                fos.getFD().sync();
            }
            JSObject out = new JSObject();
            out.put("fileName", safeName);
            out.put("path", target.getAbsolutePath());
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Safety backup failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("A valid http(s) URL is required.");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the link: " + e.getMessage(), e);
        }
    }
}
