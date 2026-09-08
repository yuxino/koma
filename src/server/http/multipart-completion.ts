import type { IncomingMessage } from "node:http";
import { MIMEType } from "node:util";

// The multipart iterator can suppress an unexpected EOF after a fully consumed file.
// Observe only the delimiter and a bounded overlap, never buffer the video itself.
export function observeMultipartCompletion(request: IncomingMessage) {
  const boundary = new MIMEType(request.headers["content-type"] || "").params.get("boundary");
  if (!boundary) throw new Error("上传表单缺少分隔符。");
  const closing = Buffer.from(`\r\n--${boundary}--`);
  let tail = Buffer.alloc(0);
  let complete = false;
  const observe = (chunk: Buffer) => {
    if (complete) return;
    const bytes = Buffer.concat([tail, chunk]);
    complete = bytes.includes(closing);
    tail = complete ? Buffer.alloc(0) : Buffer.from(bytes.subarray(-(closing.length - 1)));
  };
  request.on("data", observe);
  return {
    assertComplete() {
      if (!complete) throw new Error("视频上传不完整，请重新上传。");
    },
    dispose() { request.off("data", observe); }
  };
}
