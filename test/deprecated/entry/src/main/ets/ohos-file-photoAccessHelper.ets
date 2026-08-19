import photoAccessHelper from '@ohos.file.photoAccessHelper';
import dataSharePredicates from '@ohos.data.dataSharePredicates';
import common from '@ohos.app.ability.common';

// Scenario 1: manage assets inside a user album (add then remove).
async function manageAlbumAssets(helper: photoAccessHelper.PhotoAccessHelper): Promise<void> {
  const predicates = new dataSharePredicates.DataSharePredicates();
  predicates.equalTo('album_name', 'Vacation 2024');
  const albumOpts: photoAccessHelper.FetchOptions = {
    fetchColumns: ['uri', 'title', 'photoType'],
    predicates,
  };
  const albumResult = await helper.getAlbums(
    photoAccessHelper.AlbumType.USER,
    photoAccessHelper.AlbumSubtype.USER_GENERIC,
    albumOpts,
  );
  const albums: Array<photoAccessHelper.Album> = await albumResult.getAllObjects();
  if (albums.length === 0) {
    console.info('no user album found');
    return;
  }
  const album = albums[0];

  const assetResult = await helper.getAssets(albumOpts);
  const assets: Array<photoAccessHelper.PhotoAsset> = await assetResult.getAllObjects();
  if (assets.length === 0) {
    console.info('no photo assets found');
    return;
  }

  try {
    await album.addAssets(assets);
    console.info('assets added to album');
  } catch (e) {
    console.error('addAssets failed', e);
  }

  try {
    await album.removeAssets(assets);
    console.info('assets removed from album');
  } catch (e) {
    console.error('removeAssets failed', e);
  }
}

// Scenario 2: pop the system delete dialog for a batch of media files.
async function deleteAssetsViaDialog(helper: photoAccessHelper.PhotoAccessHelper): Promise<void> {
  const predicates = new dataSharePredicates.DataSharePredicates();
  const fetchOpts: photoAccessHelper.FetchOptions = {
    fetchColumns: ['uri'],
    predicates,
  };
  const result = await helper.getAssets(fetchOpts);
  const assets: Array<photoAccessHelper.PhotoAsset> = await result.getAllObjects();
  const uriList = assets.map((a) => a.uri);
  try {
    await helper.createDeleteRequest(uriList);
    console.info('delete request submitted');
  } catch (e) {
    console.error('createDeleteRequest failed', e);
  }
}

// Scenario 3: open a photo asset read-only, read its fd, then close it.
async function readPhotoAssetFd(helper: photoAccessHelper.PhotoAccessHelper): Promise<void> {
  const predicates = new dataSharePredicates.DataSharePredicates();
  const fetchOpts: photoAccessHelper.FetchOptions = {
    fetchColumns: ['uri', 'title'],
    predicates,
  };
  const result = await helper.getAssets(fetchOpts);
  const assets: Array<photoAccessHelper.PhotoAsset> = await result.getAllObjects();
  if (assets.length === 0) {
    console.info('no photo asset to read');
    return;
  }
  const asset = assets[0];
  let fd: number = -1;
  try {
    fd = await asset.getReadOnlyFd();
    console.info('opened read-only fd:', fd);
  } catch (e) {
    console.error('getReadOnlyFd failed', e);
    return;
  }
  try {
    await asset.close(fd);
    console.info('fd closed');
  } catch (e) {
    console.error('close failed', e);
  }
}

// Minimal receiver for getContext() so we don't rely on `this` (banned in
// standalone functions by arkts-no-standalone-this).
class ContextHost {}

async function run(): Promise<void> {
  const context = getContext(new ContextHost()) as common.Context;
  const helper = photoAccessHelper.getPhotoAccessHelper(context);
  await manageAlbumAssets(helper);
  await deleteAssetsViaDialog(helper);
  await readPhotoAssetFd(helper);
}

run();
