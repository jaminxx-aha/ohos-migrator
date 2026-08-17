import formProvider from '@ohos.application.formProvider';

const WEATHER_FORM_ID = '1001';
const TODO_FORM_ID = '1002';

async function refreshWeatherWidgetNext(): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      formProvider.setFormNextRefreshTime(WEATHER_FORM_ID, 30, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    console.info('weather form next refresh scheduled in 30 minutes');
  } catch (e) {
    console.error('failed to schedule weather form refresh', e);
  }
}

async function publishTodoWidgetUpdate(): Promise<void> {
  try {
    const data = { data: { title: 'Buy groceries', done: false, due: '2026-08-17T18:00:00' } };
    await new Promise<void>((resolve, reject) => {
      formProvider.updateForm(TODO_FORM_ID, data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    console.info('todo form updated with new task');
  } catch (e) {
    console.error('failed to update todo form', e);
  }
}

async function run(): Promise<void> {
  await refreshWeatherWidgetNext();
  await publishTodoWidgetUpdate();
}

run();
