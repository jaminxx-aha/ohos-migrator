import display from '@ohos.display';

async function listAllDisplays(): Promise<display.Display[]> {
  return new Promise((resolve, reject) => {
    display.getAllDisplay((err, displays) => {
      if (err) {
        console.error('getAllDisplay failed', err);
        reject(err);
        return;
      }
      console.info(`getAllDisplay returned ${displays.length} display(s)`);
      resolve(displays);
    });
  });
}

async function fetchDefaultDisplay(): Promise<display.Display> {
  return new Promise((resolve, reject) => {
    display.getDefaultDisplay((err, disp) => {
      if (err) {
        console.error('getDefaultDisplay failed', err);
        reject(err);
        return;
      }
      console.info(`getDefaultDisplay id=${disp.id} width=${disp.width} height=${disp.height}`);
      resolve(disp);
    });
  });
}

async function run(): Promise<void> {
  try {
    const displays = await listAllDisplays();
    const primary = await fetchDefaultDisplay();
    console.info(`display survey done: total=${displays.length}, default id=${primary.id}`);
  } catch (e) {
    console.error('display survey failed', e);
  }
}

run();
