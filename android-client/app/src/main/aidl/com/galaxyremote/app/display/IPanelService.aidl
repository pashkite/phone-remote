package com.galaxyremote.app.display;

// No command strings, paths or caller-selected display IDs cross this interface.
interface IPanelService {
    String inspect() = 0;
    String checkRecovery() = 1;
    void arm(IBinder owner, boolean externalRecoveryVerified) = 2;
    String turnOff(int seconds) = 3;
    String restore() = 4;
    void heartbeat() = 5;
    long prepareTouch(IBinder owner, boolean consent) = 6;
    boolean injectTouch(long trial, int action, float x, float y) = 7;
    boolean releaseTouch(long trial) = 8;
    String touchDiagnostics() = 9;
    void destroy() = 16777114;
}
