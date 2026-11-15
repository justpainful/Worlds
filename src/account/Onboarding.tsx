import { useState } from "react";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { ProductIcon } from "../ui/ProductIcon";
import { SignInFlow } from "./SignIn";

/** Worlds on the web keeps pages in the browser, and an account also keeps them on the person's account (src/web/vault.ts). */
const WEB = import.meta.env.VITE_WEB_DEMO === "1";

/**
 * First run: start on this PC with no account (the default, nothing waits on
 * the network), or sign in / create an account to work with other people.
 */
export function Onboarding() {
  const setSetting = useStore((s) => s.setSetting);
  const [mode, setMode] = useState<"welcome" | "account">("welcome");
  const finish = () => setSetting("account.onboarded", true);

  return (
    <Modal onClose={finish} width={440} bare className="acct-modal">
      {mode === "account" ? (
        <SignInFlow onDone={finish} onCancel={() => setMode("welcome")} />
      ) : (
        <div className="acct-flow">
          <ProductIcon name="home" size={64} className="acct-hero-product" />
          <h1 className="acct-title is-large">Welcome to Worlds</h1>
          <p className="acct-text">
            {WEB
              ? "Your pages stay in this browser and work without a connection. Sign in to keep them on your account and open them anywhere."
              : "Your pages live on this PC and work without a connection. Add an account when you want to share a workspace with other people."}
          </p>
          <div className="acct-actions is-stacked">
            <Button variant="tinted" size="large" autoFocus onClick={finish}>
              {WEB ? "Start in This Browser" : "Start on This PC"}
            </Button>
            <Button variant="plain" size="large" onClick={() => setMode("account")}>
              Sign In or Create Account
            </Button>
          </div>
          <p className="acct-footnote">You can add an account any time in Settings.</p>
        </div>
      )}
    </Modal>
  );
}
