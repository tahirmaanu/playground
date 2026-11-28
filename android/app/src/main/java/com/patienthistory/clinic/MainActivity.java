package com.patienthistory.clinic;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PatientFileStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
