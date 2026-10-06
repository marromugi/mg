# @mg/credentials

A package that hands saved login values to a harness piece without the model seeing them.

## Features

- Sets the credential store type.
  It gives the value of one field of one saved login.
- Has a store implementation on the macOS Keychain.
  It keeps one generic-password item per field, with the account `<name>/<field>`.
- Builds a credential access from a store, the declared logins, and the approval setting.
  It lists the logins usable at an origin.
  It hands over a value for one use after checking the declaration, the origin, and approval, in that order.
- Has dedicated errors for a refused use and for a store that gave no value.
  No message contains a value.

## Usage

```ts
import {
  createCredentialAccess,
  createKeychainStore,
} from "@mg/credentials";

const access = createCredentialAccess({
  store: createKeychainStore({ service: "mg" }),
  entries: [
    {
      name: "demo",
      origins: ["https://example.com"],
      fields: ["username", "password"],
    },
  ],
  approval: { needed: (use) => use.field === "password", ask },
});

const value = await access.use({
  name: "demo",
  field: "password",
  origin: "https://example.com",
});
```
