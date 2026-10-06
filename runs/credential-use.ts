import {
  CredentialDeniedError,
  CredentialStoreError,
  createCredentialAccess,
  createKeychainStore,
} from "@mg/credentials";
import { askInTerminal } from "./ask-in-terminal.ts";

const [name, field, origin, ...rest] = process.argv.slice(2);
if (
  name === undefined ||
  field === undefined ||
  origin === undefined ||
  rest.length > 0
) {
  console.error(
    "usage: node runs/credential-use.ts <name> <field> <origin>",
  );
  process.exit(2);
}

const access = createCredentialAccess({
  store: createKeychainStore({ service: "mg" }),
  entries: [
    {
      name: "demo",
      origins: ["https://example.com"],
      fields: ["username", "password"],
    },
  ],
  approval: {
    needed: (use) => use.field === "password",
    ask: askInTerminal,
  },
});

try {
  const value = await access.use({ name, field, origin });
  console.log(`allowed: value has ${value.length} characters`);
} catch (error) {
  if (
    error instanceof CredentialDeniedError ||
    error instanceof CredentialStoreError
  ) {
    console.log(`denied: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
