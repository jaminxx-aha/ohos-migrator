import osAccount from '@ohos.account.osAccount';

// Scenario: a device-management audit that walks the current OS account, probes a
// known local-id, and resolves identifiers across domain/uid/serial-number spaces.
// Uses the deprecated query/check APIs (kept for legacy callers); modern code should
// prefer the check*/get*For*/query* replacements noted in the SDK.

const manager: osAccount.AccountManager = osAccount.getAccountManager();

async function auditCurrentAccount(): Promise<void> {
  try {
    const current: osAccount.OsAccountInfo = await manager.queryCurrentOsAccount();
    const currentAlt: osAccount.OsAccountInfo = await manager.getCurrentOsAccount();
    console.info(
      'currentOsAccount: localId=%d, isActived=%s, isVerified=%s',
      current.localId, current.isActived, current.isVerified
    );

    const activatedIds: number[] = await manager.queryActivatedOsAccountIds();
    console.info('activatedOsAccountIds: count=%d', activatedIds.length);

    const localIdFromProcess: number = await manager.getOsAccountLocalIdFromProcess();
    const accountType: osAccount.OsAccountType = await manager.getOsAccountTypeFromProcess();
    const verified: boolean = await manager.checkOsAccountVerified();
    const verifiedLegacy: boolean = await manager.isOsAccountVerified();
    const testable: boolean = await manager.isTestOsAccount();
    const multiEnabled: boolean = await manager.isMultiOsAccountEnable();
    const dvid: string = await manager.getDistributedVirtualDeviceId();
    console.info(
      'process: localId=%d, type=%d, verified=%s, verifiedLegacy=%s, testable=%s, multi=%s, dvid=%s',
      localIdFromProcess, accountType, verified, verifiedLegacy, testable, multiEnabled, dvid
    );
  } catch (e) {
    console.error('auditCurrentAccount failed', e);
  }
}

async function auditAccountByLocalId(localId: number): Promise<void> {
  try {
    const activated: boolean = await manager.checkOsAccountActivated(localId);
    const activatedLegacy: boolean = await manager.isOsAccountActived(localId);
    const constraints: string[] = await manager.getOsAccountConstraints(localId);
    const allConstraints: string[] = await manager.getOsAccountAllConstraints(localId);
    const constraintEnabled: boolean =
      await manager.checkOsAccountConstraintEnabled(localId, 'constraint.wifi.set');
    const constraintEnabledLegacy: boolean =
      await manager.isOsAccountConstraintEnable(localId, 'constraint.wifi.set');
    const serial: number = await manager.getSerialNumberByOsAccountLocalId(localId);
    const localIdBySerial: number = await manager.getOsAccountLocalIdBySerialNumber(serial);
    console.info(
      'account[%d]: activated=%s, activatedLegacy=%s, constraints=%d, allConstraints=%d, wifiConstrained=%s, wifiConstrainedLegacy=%s, serial=%d, roundtripLocalId=%d',
      localId, activated, activatedLegacy, constraints.length, allConstraints.length,
      constraintEnabled, constraintEnabledLegacy, serial, localIdBySerial
    );
  } catch (e) {
    console.error('auditAccountByLocalId failed', e);
  }
}

async function auditDomainAndUidAndCount(): Promise<void> {
  try {
    const domainInfo: osAccount.DomainAccountInfo = {
      domain: 'example.com',
      accountName: 'admin'
    };
    const localIdFromDomain: number = await manager.getOsAccountLocalIdFromDomain(domainInfo);
    const localIdFromUid: number = await manager.getOsAccountLocalIdFromUid(1000);
    const createdCount: number = await manager.getCreatedOsAccountsCount();
    console.info(
      'domainLocalId=%d, uidLocalId=%d, createdCount=%d',
      localIdFromDomain, localIdFromUid, createdCount
    );
  } catch (e) {
    console.error('auditDomainAndUidAndCount failed', e);
  }
}

async function run(): Promise<void> {
  await auditCurrentAccount();
  await auditAccountByLocalId(100);
  await auditDomainAndUidAndCount();
}

run();
