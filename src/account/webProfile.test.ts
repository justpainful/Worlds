import { describe, expect, it } from "vitest";
import { missingFields, vaultBase } from "./webProfileRules";

describe("web profile on a computer", () => {
  it("finds the sync service from the setting or from the account service", () => {
    expect(vaultBase("wss://connect.enterworlds.space/")).toBe("https://connect.enterworlds.space");
    expect(vaultBase("http://localhost:8790")).toBe("http://localhost:8790");
    expect(vaultBase(null, "https://login.enterworlds.space")).toBe("https://connect.enterworlds.space");
    expect(vaultBase("", "https://login.example.com/")).toBe("https://connect.example.com");
    expect(vaultBase(null, "http://localhost:8787")).toBeNull();
  });

  it("fills only what the profile here is missing", () => {
    const here = { bio: "", status: null, accent: "#ff0000", links: [], bannerFocus: null, avatarCrop: "50,50,1" };
    const web = { bio: "Hi", status: "Busy", accent: "#2e92ff", links: [{ label: "X", url: "https://x.com" }], bannerFocus: "0.5,0.3", avatarCrop: "40,40,2" };
    expect(missingFields(here, web)).toEqual({ bio: "Hi", status: "Busy", links: web.links, bannerFocus: "0.5,0.3" });
    expect(missingFields({ bio: "Mine" }, { bio: "" })).toEqual({});
  });
});
