import wallpaper from '@ohos.wallpaper';

// Inspect the dominant colors of the current home-screen wallpaper and read each
// RGBA channel of the first returned color (each channel is itself a deprecated field).
async function inspectWallpaperColors(): Promise<void> {
  return new Promise((resolve, reject) => {
    wallpaper.getColors(wallpaper.WallpaperType.WALLPAPER_SYSTEM, (err, colors: Array<wallpaper.RgbaColor>) => {
      if (err) {
        console.error('getColors failed', err);
        reject(err);
        return;
      }
      const dominant: wallpaper.RgbaColor = colors[0];
      const red = dominant.red;
      const green = dominant.green;
      const blue = dominant.blue;
      const alpha = dominant.alpha;
      console.info(`dominant color rgba(${red}, ${green}, ${blue}, ${alpha})`);
      resolve();
    });
  });
}

// Read wallpaper metadata: file descriptor, wallpaper id, and the min dimensions the
// system requires for a wallpaper image.
async function readWallpaperMetadata(): Promise<void> {
  const fileFd: number = await new Promise((resolve, reject) => {
    wallpaper.getFile(wallpaper.WallpaperType.WALLPAPER_SYSTEM, (err, fd: number) => {
      if (err) {
        console.error('getFile failed', err);
        reject(err);
        return;
      }
      resolve(fd);
    });
  });
  console.info('wallpaper file fd:', fileFd);

  const wallpaperId: number = await new Promise((resolve, reject) => {
    wallpaper.getId(wallpaper.WallpaperType.WALLPAPER_SYSTEM, (err, id: number) => {
      if (err) {
        console.error('getId failed', err);
        reject(err);
        return;
      }
      resolve(id);
    });
  });
  console.info('wallpaper id:', wallpaperId);

  const minHeight: number = await new Promise((resolve, reject) => {
    wallpaper.getMinHeight((err, h: number) => {
      if (err) {
        console.error('getMinHeight failed', err);
        reject(err);
        return;
      }
      resolve(h);
    });
  });
  const minWidth: number = await new Promise((resolve, reject) => {
    wallpaper.getMinWidth((err, w: number) => {
      if (err) {
        console.error('getMinWidth failed', err);
        reject(err);
        return;
      }
      resolve(w);
    });
  });
  console.info(`min wallpaper size: ${minWidth}x${minHeight}`);
}

// Guard before attempting to change the wallpaper: confirm the user/app is permitted.
async function ensureChangePermitted(): Promise<boolean> {
  const changePermitted: boolean = await new Promise((resolve, reject) => {
    wallpaper.isChangePermitted((err, permitted: boolean) => {
      if (err) {
        console.error('isChangePermitted failed', err);
        reject(err);
        return;
      }
      resolve(permitted);
    });
  });
  const operationAllowed: boolean = await new Promise((resolve, reject) => {
    wallpaper.isOperationAllowed((err, allowed: boolean) => {
      if (err) {
        console.error('isOperationAllowed failed', err);
        reject(err);
        return;
      }
      resolve(allowed);
    });
  });
  return changePermitted && operationAllowed;
}

// Apply a new home-screen wallpaper from a local JPEG uri and (on failure) reset back
// to the system default.
async function applyWallpaper(imageUri: string): Promise<void> {
  const permitted = await ensureChangePermitted();
  if (!permitted) {
    console.warn('wallpaper change not permitted');
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      wallpaper.setWallpaper(imageUri, wallpaper.WallpaperType.WALLPAPER_SYSTEM, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    console.info('wallpaper set');
  } catch (e) {
    console.error('setWallpaper failed, resetting', e);
    await new Promise<void>((resolve, reject) => {
      wallpaper.reset(wallpaper.WallpaperType.WALLPAPER_SYSTEM, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

// Subscribe to live wallpaper color changes while the app is in the foreground.
function subscribeColorChanges(): void {
  wallpaper.on('colorChange', (colors: Array<wallpaper.RgbaColor>, wallpaperType: wallpaper.WallpaperType) => {
    console.info(`colorChange for type ${wallpaperType}, ${colors.length} dominant colors`);
  });
}

function unsubscribeColorChanges(): void {
  wallpaper.off('colorChange');
}

async function run(): Promise<void> {
  subscribeColorChanges();
  try {
    await inspectWallpaperColors();
    await readWallpaperMetadata();
    await applyWallpaper('file:///data/storage/el2/files/wp_home.jpg');
  } catch (e) {
    console.error('wallpaper flow failed', e);
  } finally {
    unsubscribeColorChanges();
  }
}

run();
