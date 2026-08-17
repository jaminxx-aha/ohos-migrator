import distributedAccount from '@ohos.account.distributedAccount';

// Scenario: synchronize the distributed account profile for the current OS account.
// Uses the deprecated query/update APIs (kept for legacy callers); modern code should
// prefer getOsAccountDistributedInfo / setOsAccountDistributedInfo.

async function queryDistributedInfo(): Promise<distributedAccount.DistributedInfo | null> {
  const ability: distributedAccount.DistributedAccountAbility =
    distributedAccount.getDistributedAccountAbility();
  try {
    const info: distributedAccount.DistributedInfo =
      await ability.queryOsAccountDistributedInfo();
    console.info('distributedInfo: name=%s, id=%s, event=%s', info.name, info.id, info.event);
    return info;
  } catch (e) {
    console.error('queryOsAccountDistributedInfo failed', e);
    return null;
  }
}

async function updateDistributedInfo(): Promise<void> {
  const ability: distributedAccount.DistributedAccountAbility =
    distributedAccount.getDistributedAccountAbility();
  const info: distributedAccount.DistributedInfo = {
    name: 'alice@example.com',
    id: '10086001',
    event: 'login',
    nickname: 'Alice',
    avatar: 'https://example.com/avatars/alice.png',
    scalableData: { source: 'mobile', version: 1 }
  };
  try {
    await ability.updateOsAccountDistributedInfo(info);
    console.info('updateOsAccountDistributedInfo succeeded');
  } catch (e) {
    console.error('updateOsAccountDistributedInfo failed', e);
  }
}

async function run(): Promise<void> {
  const current = await queryDistributedInfo();
  if (current && current.id !== '10086001') {
    await updateDistributedInfo();
  }
}

run();
