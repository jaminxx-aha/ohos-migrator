import appAccount from '@ohos.account.appAccount';

const ACCOUNT_NAME = 'com.example.user.alice';
const OWNER = 'com.example.authservice';
const BUNDLE = 'com.example.callerapp';
const AUTH_TYPE = 'OAuth2';
const CREDENTIAL_TYPE = 'password';
const SESSION_ID = 'session-1024';

function createAuthenticatorCallback(): appAccount.AuthenticatorCallback {
  return {
    onResult: (code, result) => {
      console.info(`auth result code=${code}`, JSON.stringify(result));
    },
    onRequestRedirected: (request) => {
      console.info('auth request redirected', JSON.stringify(request));
    },
  };
}

// Scenario 1: provision and tear down an application account lifecycle
async function provisionAppAccount(): Promise<void> {
  const manager = appAccount.createAppAccountManager();
  try {
    await manager.addAccount(ACCOUNT_NAME);
    await manager.setAccountExtraInfo(ACCOUNT_NAME, JSON.stringify({ plan: 'premium' }));
    await manager.setAccountCredential(ACCOUNT_NAME, CREDENTIAL_TYPE, 'p@ssw0rd-hash');
    await manager.setAppAccountSyncEnable(ACCOUNT_NAME, true);
    await manager.setAssociatedData(ACCOUNT_NAME, 'email', 'alice@example.com');
    await manager.enableAppAccess(ACCOUNT_NAME, BUNDLE);
    await manager.disableAppAccess(ACCOUNT_NAME, BUNDLE);
  } catch (e) {
    console.error('provisionAppAccount failed', e);
  } finally {
    try {
      await manager.deleteAccount(ACCOUNT_NAME);
    } catch (e) {
      console.error('provisionAppAccount cleanup failed', e);
    }
  }
}

// Scenario 2: query account metadata and sync state
async function queryAppAccountInfo(): Promise<void> {
  const manager = appAccount.createAppAccountManager();
  try {
    const owned = await manager.getAllAccounts(OWNER);
    console.info(`accounts owned by ${OWNER}: ${owned.length}`);
    const accessible = await manager.getAllAccessibleAccounts();
    console.info(`accessible accounts: ${accessible.length}`);
    const extra = await manager.getAccountExtraInfo(ACCOUNT_NAME);
    console.info(`extra info: ${extra}`);
    const credential = await manager.getAccountCredential(ACCOUNT_NAME, CREDENTIAL_TYPE);
    console.info(`credential: ${credential}`);
    const email = await manager.getAssociatedData(ACCOUNT_NAME, 'email');
    console.info(`email: ${email}`);
    const syncOn = await manager.checkAppAccountSyncEnable(ACCOUNT_NAME);
    console.info(`sync enabled: ${syncOn}`);
  } catch (e) {
    console.error('queryAppAccountInfo failed', e);
  }
}

// Scenario 3: OAuth token lifecycle (set/get/visibility/list/delete)
async function manageOAuthTokens(): Promise<void> {
  const manager = appAccount.createAppAccountManager();
  try {
    await manager.setOAuthToken(ACCOUNT_NAME, AUTH_TYPE, 'token-abc-123');
    const token = await manager.getOAuthToken(ACCOUNT_NAME, OWNER, AUTH_TYPE);
    console.info(`oauth token: ${token}`);
    await manager.setOAuthTokenVisibility(ACCOUNT_NAME, AUTH_TYPE, BUNDLE, true);
    const visible = await manager.checkOAuthTokenVisibility(ACCOUNT_NAME, AUTH_TYPE, BUNDLE);
    console.info(`token visible to ${BUNDLE}: ${visible}`);
    const tokens = await manager.getAllOAuthTokens(ACCOUNT_NAME, OWNER);
    tokens.forEach((info: appAccount.OAuthTokenInfo) => {
      console.info(`token authType=${info.authType} value=${info.token}`);
    });
    const list = await manager.getOAuthList(ACCOUNT_NAME, AUTH_TYPE);
    console.info(`oauth list size: ${list.length}`);
    await manager.deleteOAuthToken(ACCOUNT_NAME, OWNER, AUTH_TYPE, 'token-abc-123');
  } catch (e) {
    console.error('manageOAuthTokens failed', e);
  }
}

// Scenario 4: drive the authenticator flow and subscribe/unsubscribe change events
async function driveAuthenticator(): Promise<void> {
  const manager = appAccount.createAppAccountManager();
  const authenticator = new appAccount.Authenticator();
  const callback = createAuthenticatorCallback();
  const options: { [key: string]: any } = { scope: 'profile' };
  try {
    authenticator.addAccountImplicitly(AUTH_TYPE, BUNDLE, options, callback);
    authenticator.authenticate(ACCOUNT_NAME, AUTH_TYPE, BUNDLE, options, callback);
    manager.addAccountImplicitly(OWNER, AUTH_TYPE, options, callback);
    manager.authenticate(ACCOUNT_NAME, OWNER, AUTH_TYPE, options, callback);
    const info = await manager.getAuthenticatorInfo(OWNER);
    console.info(`authenticator owner: ${info.owner}`);
    const authCallback = await manager.getAuthenticatorCallback(SESSION_ID);
    authCallback.onResult(appAccount.ResultCode.SUCCESS, { name: ACCOUNT_NAME });
    authCallback.onRequestRedirected({});
  } catch (e) {
    console.error('driveAuthenticator failed', e);
  }

  const onChange: (accounts: appAccount.AppAccountInfo[]) => void = (accounts) => {
    console.info(`change event: ${accounts.length} accounts`);
  };
  manager.on('change', [OWNER], onChange);
  manager.off('change', onChange);
}

// Scenario 5: enumerate legacy constants and the full ResultCode enum
function logLegacyConstants(): void {
  const implicitAction = appAccount.Constants.ACTION_ADD_ACCOUNT_IMPLICITLY;
  const authAction = appAccount.Constants.ACTION_AUTHENTICATE;
  console.info(`constants: ${implicitAction}, ${authAction}`);
  const codes: number[] = [
    appAccount.ResultCode.SUCCESS,
    appAccount.ResultCode.ERROR_ACCOUNT_NOT_EXIST,
    appAccount.ResultCode.ERROR_APP_ACCOUNT_SERVICE_EXCEPTION,
    appAccount.ResultCode.ERROR_INVALID_PASSWORD,
    appAccount.ResultCode.ERROR_INVALID_REQUEST,
    appAccount.ResultCode.ERROR_INVALID_RESPONSE,
    appAccount.ResultCode.ERROR_NETWORK_EXCEPTION,
    appAccount.ResultCode.ERROR_OAUTH_AUTHENTICATOR_NOT_EXIST,
    appAccount.ResultCode.ERROR_OAUTH_CANCELED,
    appAccount.ResultCode.ERROR_OAUTH_LIST_TOO_LARGE,
    appAccount.ResultCode.ERROR_OAUTH_SERVICE_BUSY,
    appAccount.ResultCode.ERROR_OAUTH_SERVICE_EXCEPTION,
    appAccount.ResultCode.ERROR_OAUTH_SESSION_NOT_EXIST,
    appAccount.ResultCode.ERROR_OAUTH_TIMEOUT,
    appAccount.ResultCode.ERROR_OAUTH_TOKEN_NOT_EXIST,
    appAccount.ResultCode.ERROR_OAUTH_TOKEN_TOO_MANY,
    appAccount.ResultCode.ERROR_OAUTH_UNSUPPORT_ACTION,
    appAccount.ResultCode.ERROR_OAUTH_UNSUPPORT_AUTH_TYPE,
    appAccount.ResultCode.ERROR_PERMISSION_DENIED,
  ];
  console.info(`result codes: ${codes.join(',')}`);
}

async function run(): Promise<void> {
  await provisionAppAccount();
  await queryAppAccountInfo();
  await manageOAuthTokens();
  await driveAuthenticator();
  logLegacyConstants();
}

run();
