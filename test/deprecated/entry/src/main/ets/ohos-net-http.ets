import http from '@ohos.net.http';

declare let _v0: http.HttpRequest; _v0.off("headerReceive");
declare let _v1: http.HttpRequest; _v1.on("headerReceive", () => {});
