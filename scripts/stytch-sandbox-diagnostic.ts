import { getStytchCallbackUrl, getStytchClient } from "../server/stytch";

const environment = process.env.STYTCH_ENVIRONMENT?.trim() ?? "";

async function main() {
  if (!(environment === "test" || environment.startsWith("test-"))) {
    console.log("STYTCH_SANDBOX_NOT_RUN: test environment is required");
    return;
  }

  try {
    const client = getStytchClient();
    await client.passwords.create({
      email: "sandbox@stytch.com",
      password: "KairemaSandboxOnly_7!",
    });
    console.log("STYTCH_SANDBOX_PASSWORD_CREATE_PASS");
    await client.passwords.authenticate({
      email: "sandbox@stytch.com",
      password: "KairemaSandboxOnly_7!",
    });
    console.log("STYTCH_SANDBOX_PASSWORD_AUTHENTICATE_PASS");
    await client.magicLinks.email.loginOrCreate({
      email: "sandbox@stytch.com",
      login_magic_link_url: getStytchCallbackUrl(),
      signup_magic_link_url: getStytchCallbackUrl(),
    });
    console.log("STYTCH_SANDBOX_MAGIC_LINK_PASS");
  } catch (error: unknown) {
    const safeErrorType =
      error &&
      typeof error === "object" &&
      "error_type" in error &&
      typeof error.error_type === "string"
        ? error.error_type.replace(/[^a-z0-9_-]/gi, "").slice(0, 80)
        : "unknown";
    console.log(`STYTCH_SANDBOX_STAGE_FAIL:${safeErrorType}`);
    process.exitCode = 1;
  }
}

void main();
