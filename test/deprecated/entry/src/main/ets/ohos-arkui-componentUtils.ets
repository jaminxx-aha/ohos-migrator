import componentUtils from '@ohos.arkui.componentUtils';

// Scenario: measure a component's drawing rectangle by id to drive layout logic.
async function measureComponentRect(id: string): Promise<void> {
  try {
    const info = componentUtils.getRectangleById(id);
    console.info(`component ${id} rect: x=${info.x}, y=${info.y}, width=${info.width}, height=${info.height}`);
  } catch (e) {
    console.error('getRectangleById failed', e);
  }
}

async function run(): Promise<void> {
  await measureComponentRect('loginButton');
}

run();
