import crypto from "crypto";
import fs from "fs";

/**
 * WhatsApp Flow endpoint encryption (data_api_version 3.0).
 * @see https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */

export function loadFlowPrivateKeyPem() {
  const path = process.env.FLOW_PRIVATE_KEY_PATH;
  if (path && fs.existsSync(path)) {
    return fs.readFileSync(path, "utf8");
  }
  const inline = process.env.FLOW_PRIVATE_KEY;
  if (inline) {
    return inline.replace(/\\n/g, "\n");
  }
  // Fallback hardcoded key
  return `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDHV3WDpPkcVHqi
hm1P0OupYlOzEd+dC8cdWaomBtO5wftiKuw7Ok7KuG+LGBMnOtZ0FfbkZZx2MUnj
kxan40iNlFrXFsbMAd5uogqrQvHv4V9Pgig5sU9XNpXOFVJbN4GLFJCsKiop1f/u
f0CATv6E93YH3HqzDBPRufBKU1ZEY4ohTYPVdsMt9U+jX8h0F1ah88D4QUN/KWjF
ZlEhb8ZZ8n83kc2UzyQu3EfilQARECj2TLtBIyyPY45d7WW015etPmx/DdMtaEDY
s3YrqT9ENRkY60UCk0vjhITxI+/qOOmR2g7AVUT53hRAXot2eIAvdp1HPYHasq+r
2PB6PTHNAgMBAAECggEACWflYfEj1qQJ0VIPJbKm8VbJZOv/+soL0CUN8+i4js2f
Y0dr3sjmijGKWdbTTd48hj0PFEHTJc83kacRbO862itY30ic2BLH1b029v5xVK9J
Wa1mNoADorWEULVi2G5Vt3lLRkRgZERLujYuQJ+kP3k/DCnpbuSv/re2UIYpeOU1
f3J1OSyFaIp1a2YMuXbT3WhENT/ErYfQPdCFARRr7b+AcfUDYxnwbK77YiD6cEyE
tHWmIo751Ap6js8JW/2WuUClXYy568l9OnuQYZ2CIgz72GBDPSL5B72r7JzD4QY+
nC6wunJ+XQcmZPnbxVEWOWnLPnUyQeaZE3SEKdBAgQKBgQDlhYgP8BJZ7AmL32Pp
ixaw49sPqsvjdJM5kmLWu3NgKjcZkaDPdJqtFPJpfj2dAFJfsrdr+zOhxhzrS5d7
cxNSSyOW32d5atHLEJqSqMIM6sFwAa4OCKrd5s3jSUE72DDsMwgXlthoaSROjH7t
eQ92hJF3/BoQ+H5DrzYzZmmHoQKBgQDeVp8fbiWxxbnuYl5gCljQcLyHdAnXzpv/
i7JO6f5NcnoCGillbrayw/nsbb+7fB4XxiJTpMVfUpBZZXxXVpPkkKeg+8hIAGT7
EYR3PaYCnmcAwiB3BN+OyzuAi7WEYDm/FJeN0fAIH1mYi+wjghl2vL9ldXz0nV3t
RAC7SLhKrQKBgHJU8BAwYJPWlnLMlrKRjH4VItxNEj99pJD7MK0St0hh/wyHlHmC
9kHdu1t9fSemL2JoXiI2AeRGEcXL4+ukyS0nLNVM9/htk4/592WzFubkUfN/grqO
6r6a6Fid9xbefJBMY22MwMRSC7ntFpUoxuEc7HG+bSWjAxKoRvGXxF3BAoGAIkSt
j9WVP7oe9yv4KctOdwn5NNNgtP9mMdPhLqKIDH3JakuH99dBl3n3KkacF5SAut9R
6RxrQ07harXmnTt93euhuoE0FEzjQ4MmrI426Q5rB8Xj5RQ+NK8EQ8LEvltqaxYM
adJisY3LbGSch7iEnjVnNocONFGQ6YHirvr9VJ0CgYBuEKLtCw+rYoeFunZLyHuy
XBUcnExM8km1iWwhKKaa/f+Y1Y0na3mEKfHzHVCM8jZLJ6OQ7d995N3PWoalXaZ0
dgLye4lsHXa3qFxFlldvgLfhAg7qXTRPz5Yw4HbI+l2SrqI2Mu2dWgV8ae0Ok4Xw
MqTYcqHL+Z8Y7BkN1T8PUQ==
-----END PRIVATE KEY-----`;
}

export function decryptFlowRequest(body, privateKeyPem) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new Error("missing_encrypted_fields");
  }

  const decryptedAesKey = crypto.privateDecrypt(
    {
      key: crypto.createPrivateKey(privateKeyPem),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
  const initialVectorBuffer = Buffer.from(initial_vector, "base64");

  const TAG_LENGTH = 16;
  const encryptedFlowDataBody = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const encryptedFlowDataTag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    decryptedAesKey,
    initialVectorBuffer
  );
  decipher.setAuthTag(encryptedFlowDataTag);

  const decryptedJSONString = Buffer.concat([
    decipher.update(encryptedFlowDataBody),
    decipher.final()
  ]).toString("utf-8");

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer
  };
}

export function encryptFlowResponse(responseObject, aesKeyBuffer, initialVectorBuffer) {
  const flippedIv = Buffer.alloc(initialVectorBuffer.length);
  for (let i = 0; i < initialVectorBuffer.length; i++) {
    flippedIv[i] = initialVectorBuffer[i] ^ 0xff;
  }

  const cipher = crypto.createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIv);
  return Buffer.concat([
    cipher.update(JSON.stringify(responseObject), "utf-8"),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString("base64");
}