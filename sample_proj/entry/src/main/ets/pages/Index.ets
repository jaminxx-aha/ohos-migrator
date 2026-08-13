import dataUriUtils from '@ohos.app.ability.dataUriUtils';
import rdb from '@ohos.data.relationalStore';
import prompt from '@ohos.promptAction';
import reminderAgent from '@ohos.reminderAgent';
import abilityDataUriUtils from '@ohos.app.ability.dataUriUtils';
import wantConstant from '@ohos.ability.wantConstant';
import commonEventManager from '@ohos.commonEventManager';

@Entry
@Component
struct Index {
  @State msg: string = 'hi';
  build() {
    Column() {
      Text(this.msg)
    }
    .onClick(() => {
      const id = dataUriUtils.getId('x');
      rdb.getRdbStore(null as any);
      prompt.showToast({ message: 'done' });
      reminderAgent.publishReminder(null as any);
      abilityDataUriUtils.getId('y');
      const action = wantConstant.Action.ACTION_HOME;
      const entity = wantConstant.Entity.ENTITY_HOME;
      const event = commonEventManager.Support.COMMON_EVENT_USER_PRESENT;
      const btEvent = commonEventManager.Support.COMMON_EVENT_BLUETOOTH_HOST_NAME_UPDATE;
      console.log(action, entity, event, btEvent);
    });
  }
}
