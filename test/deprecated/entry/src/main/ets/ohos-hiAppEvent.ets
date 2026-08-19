import hiAppEvent from '@ohos.hiAppEvent';

// Scenario: configure the application event logger and emit preset / business events.

// Configure logging: disable the switch off (keep logging on) and set a 10MB storage quota.
const loggingConfig: hiAppEvent.ConfigOption = {};
loggingConfig.disable = false;
loggingConfig.maxStorage = '10MB';
hiAppEvent.configure(loggingConfig);

// Report a user login event with the preset USER_ID param.
async function reportUserLogin(userId: string): Promise<void> {
    const params: Record<string, string> = {};
    params[hiAppEvent.Param.USER_ID] = userId;
    try {
        await hiAppEvent.write(hiAppEvent.Event.USER_LOGIN, hiAppEvent.EventType.BEHAVIOR, params);
    } catch (e) {
        console.error('failed to write user-login event', e);
    }
}

// Report a user logout event.
async function reportUserLogout(userId: string): Promise<void> {
    const params: Record<string, string> = {};
    params[hiAppEvent.Param.USER_ID] = userId;
    try {
        await hiAppEvent.write(hiAppEvent.Event.USER_LOGOUT, hiAppEvent.EventType.BEHAVIOR, params);
    } catch (e) {
        console.error('failed to write user-logout event', e);
    }
}

// Report a distributed service start, including distributed service name and instance id.
async function reportDistributedServiceStart(serviceName: string, instanceId: string): Promise<void> {
    const params: Record<string, string> = {};
    params[hiAppEvent.Param.DISTRIBUTED_SERVICE_NAME] = serviceName;
    params[hiAppEvent.Param.DISTRIBUTED_SERVICE_INSTANCE_ID] = instanceId;
    try {
        await hiAppEvent.write(hiAppEvent.Event.DISTRIBUTED_SERVICE_START, hiAppEvent.EventType.STATISTIC, params);
    } catch (e) {
        console.error('failed to write distributed-service-start event', e);
    }
}

// Report an application fault and a security event for audit.
async function reportFaultAndSecurity(): Promise<void> {
    try {
        await hiAppEvent.write('APP_CRASH', hiAppEvent.EventType.FAULT, { module: 'entry', stack: '...' });
        await hiAppEvent.write('UNAUTHORIZED_ACCESS', hiAppEvent.EventType.SECURITY, { target: 'settings' });
    } catch (e) {
        console.error('failed to write fault/security events', e);
    }
}

async function run(): Promise<void> {
    await reportUserLogin('user-1001');
    await reportUserLogout('user-1001');
    await reportDistributedServiceStart('continuation-service', 'instance-42');
    await reportFaultAndSecurity();
}

run();
