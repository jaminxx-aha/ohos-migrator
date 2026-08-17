import picker from '@ohos.file.picker';

picker.PhotoSaveOptions;
declare let _v0: picker.PhotoSaveOptions; _v0.newFileNames;
picker.PhotoSelectOptions;
declare let _v1: picker.PhotoSelectOptions; _v1.MIMEType;
declare let _v2: picker.PhotoSelectOptions; _v2.maxSelectNumber;
picker.PhotoSelectResult;
declare let _v3: picker.PhotoSelectResult; _v3.isOriginalPhoto;
declare let _v4: picker.PhotoSelectResult; _v4.photoUris;
picker.PhotoViewMIMETypes;
picker.PhotoViewMIMETypes.IMAGE_TYPE;
picker.PhotoViewMIMETypes.IMAGE_VIDEO_TYPE;
picker.PhotoViewMIMETypes.VIDEO_TYPE;
picker.PhotoViewPicker;
declare let _v5: picker.PhotoViewPicker; _v5.save();
declare let _v6: picker.PhotoViewPicker; _v6.select();
