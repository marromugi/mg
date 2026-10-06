export type CredentialContext = { signal?: AbortSignal };

// 保存してあるログインのひとつの項目の値を渡します。
export interface CredentialStore {
  read(
    name: string,
    field: string,
    context?: CredentialContext,
  ): Promise<string>;
}

export type CredentialEntry = {
  name: string;
  // 値を使ってよいサイトです。origin そのもの（パスなし）だけを書きます。
  origins: readonly string[];
  fields: readonly string[];
};

export type CredentialUse = {
  name: string;
  field: string;
  origin: string;
};

export type CredentialApproval =
  | { needed: false }
  | {
      needed:
        true | ((use: CredentialUse) => boolean | Promise<boolean>);
      ask: (
        use: CredentialUse,
        context?: CredentialContext,
      ) => Promise<boolean>;
    };

export interface CredentialAccess {
  usableAt(
    origin: string,
  ): readonly { name: string; fields: readonly string[] }[];
  use(use: CredentialUse, context?: CredentialContext): Promise<string>;
}
