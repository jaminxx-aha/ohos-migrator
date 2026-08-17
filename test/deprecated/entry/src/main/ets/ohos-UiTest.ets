import { BY, By, UiComponent, UiDriver, UiWindow, WindowFilter, Driver } from '@ohos.UiTest';

// Scenario 1: drive a login flow on the device UI using the legacy UiDriver.
async function driveLoginFlow(driver: UiDriver): Promise<void> {
  // Locate the username TextInput by its text label and inject credentials.
  const userBy: By = BY.text('Username').isAfter(BY.type('TextInput'));
  await driver.assertComponentExist(userBy);
  const userField: UiComponent = await driver.findComponent(userBy);
  await userField.inputText('alice@example.com');

  // Locate the password field relatively and type into it.
  const pwdBy: By = BY.text('Password').isBefore(BY.key('submit_btn'));
  const pwdField: UiComponent = await driver.findComponent(pwdBy);
  await pwdField.inputText('P@ssw0rd!');

  // Tap the submit button to log in.
  const submitBy: By = BY.key('submit_btn').clickable(true);
  const submitBtn: UiComponent = await driver.findComponent(submitBy);
  await submitBtn.click();

  // Trigger the Enter key to submit the form, then back out.
  await driver.triggerKey(66); // KEYCODE_ENTER
  await driver.delayMs(500);
  await driver.pressBack();
}

// Scenario 2: inspect a list of matched components and their attributes.
async function inspectListAttributes(driver: UiDriver): Promise<void> {
  // Find every clickable, enabled row in the list.
  const rowBy: By = BY.clickable(true).enabled(true);
  const rows: UiComponent[] = await driver.findComponents(rowBy);
  for (const row of rows) {
    const id: number = await row.getId();
    const key: string = await row.getKey();
    const text: string = await row.getText();
    const type: string = await row.getType();
    const clickable: boolean = await row.isClickable();
    const enabled: boolean = await row.isEnabled();
    const focused: boolean = await row.isFocused();
    const scrollable: boolean = await row.isScrollable();
    const selected: boolean = await row.isSelected();
    console.info(`row id=${id} key=${key} text=${text} type=${type} ` +
      `clickable=${clickable} enabled=${enabled} focused=${focused} ` +
      `scrollable=${scrollable} selected=${selected}`);
  }
}

// Scenario 3: scroll a scrollable container to find a target item, then act on it.
async function scrollAndActivateItem(driver: UiDriver): Promise<void> {
  // Locate the scrollable list container.
  const listBy: By = BY.scrollable(true).focused(false);
  const list: UiComponent = await driver.findComponent(listBy);

  // Scroll within the list to find the item labelled 'Settings'.
  const targetBy: By = BY.text('Settings').selected(false);
  const item: UiComponent = await list.scrollSearch(targetBy);
  await item.doubleClick();

  // Long-click another row found by numeric id to reveal a context menu.
  const menuBy: By = BY.id(1024).type('Text');
  const menuRow: UiComponent = await list.scrollSearch(menuBy);
  await menuRow.longClick();
}

// Scenario 4: coordinate-based gestures and a screenshot capture.
async function performGesturesAndCapture(driver: UiDriver): Promise<void> {
  // Tap the top-left action button by coordinates.
  await driver.click(120, 240);
  await driver.delayMs(300);

  // Double-click the centre of the banner.
  await driver.doubleClick(540, 400);

  // Long-press the FAB to open quick actions.
  await driver.longClick(980, 1700);

  // Swipe up to dismiss an overlay.
  await driver.swipe(540, 1800, 540, 600);

  // Capture a screenshot for the test report.
  const captured: boolean = await driver.screenCap('/data/local/tmp/uitest.png');
  console.info(`screenCap ok=${captured}`);
}

// Scenario 5: locate the active application window and query its active state.
async function checkActiveWindow(): Promise<void> {
  // Build a window filter referencing the deprecated 'actived' flag.
  const filter: WindowFilter = { bundleName: 'com.example.app', title: 'MainPage' };
  filter.actived = true;

  const newDriver: Driver = Driver.create();
  const window: UiWindow = await newDriver.findWindow(filter);
  const actived: boolean = await window.isActived();
  console.info(`window isActived=${actived}`);
}

async function run(): Promise<void> {
  const driver: UiDriver = UiDriver.create();
  try {
    await driveLoginFlow(driver);
    await inspectListAttributes(driver);
    await scrollAndActivateItem(driver);
    await performGesturesAndCapture(driver);
    await checkActiveWindow();
  } catch (e) {
    console.error('UiTest scenario failed', e);
  }
}

run();
