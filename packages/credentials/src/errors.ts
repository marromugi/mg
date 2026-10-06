// 使うことを断ったときの失敗です。message に理由を書きます。
export class CredentialDeniedError extends Error {
  override readonly name = "CredentialDeniedError";
}

// ストアが値を渡せなかったときの失敗です。値は message にも cause にも入りません。
export class CredentialStoreError extends Error {
  override readonly name = "CredentialStoreError";
}
