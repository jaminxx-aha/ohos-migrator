import wallpaper from '@ohos.wallpaper';

let _v0: wallpaper.RgbaColor;
declare let _v1: wallpaper.RgbaColor; _v1.alpha;
declare let _v2: wallpaper.RgbaColor; _v2.blue;
declare let _v3: wallpaper.RgbaColor; _v3.green;
declare let _v4: wallpaper.RgbaColor; _v4.red;
wallpaper.getColors(wallpaper.WallpaperType.WALLPAPER_SYSTEM);
wallpaper.getFile(wallpaper.WallpaperType.WALLPAPER_SYSTEM);
wallpaper.getId(wallpaper.WallpaperType.WALLPAPER_SYSTEM);
wallpaper.getMinHeight();
wallpaper.getMinWidth();
wallpaper.isChangePermitted();
wallpaper.isOperationAllowed();
wallpaper.off('colorChange');
wallpaper.on('colorChange', () => {});
wallpaper.reset(wallpaper.WallpaperType.WALLPAPER_SYSTEM);
wallpaper.setWallpaper;
