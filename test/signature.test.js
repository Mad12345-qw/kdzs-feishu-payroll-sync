import test from "node:test";
import assert from "node:assert/strict";
import { createSignature } from "../src/kdzs-client.js";

test("按快麦文档算法进行 ASCII 排序和 MD5 签名", () => {
  const params = {
    method: "kdzs.logistics.trace.get", appKey: "1111111", timestamp: "2021-07-28 18:15:31",
    sign_method: "md5", format: "json", version: "1.0", cpCode: "ZTO", mailNo: "75491257306780",
  };
  // 文档公布的示例摘要与它自己给出的拼接字符串不一致；此值由文档算法和拼接字符串直接计算。
  assert.equal(createSignature(params, "helloworld"), "1754811FF4FD86EE45FE646C2CAE1522");
});

test("空值和 sign 不参与签名", () => {
  const base = createSignature({ a: "1", b: "", sign: "old" }, "secret");
  assert.equal(base, createSignature({ a: "1" }, "secret"));
});
