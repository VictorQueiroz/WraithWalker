import { describe, expect, it } from "vitest";

import {
  projectDisplayName,
  projectIdForHostname,
  projectIdForOrigin,
  registrableDomain
} from "../src/domains.mts";

describe("registrableDomain", () => {
  it("collapses subdomains to the registrable domain", () => {
    expect(registrableDomain("www.google.com")).toBe("google.com");
    expect(registrableDomain("api.app.example.com")).toBe("example.com");
    expect(registrableDomain("github.githubassets.com")).toBe(
      "githubassets.com"
    );
  });

  it("keeps two-label hostnames as-is", () => {
    expect(registrableDomain("google.com")).toBe("google.com");
    expect(registrableDomain("godbolt.org")).toBe("godbolt.org");
  });

  it("handles known two-level public suffixes", () => {
    expect(registrableDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(registrableDomain("shop.example.com.br")).toBe("example.com.br");
    expect(registrableDomain("my-app.github.io")).toBe("my-app.github.io");
    expect(registrableDomain("some-space.github.dev")).toBe(
      "some-space.github.dev"
    );
  });

  it("infers unknown ccTLD second-level suffixes", () => {
    expect(registrableDomain("www.example.co.zz")).toBe("example.co.zz");
  });

  it("leaves IPs, localhost, and single labels untouched", () => {
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(registrableDomain("localhost")).toBe("localhost");
    expect(registrableDomain("[::1]")).toBe("::1");
  });

  it("normalizes case and trailing dots", () => {
    expect(registrableDomain("WWW.Example.COM.")).toBe("example.com");
  });
});

describe("projectIdForOrigin", () => {
  it("derives the project id from the origin hostname", () => {
    expect(projectIdForOrigin("https://app.google.com")).toBe("google.com");
    expect(projectIdForOrigin("http://localhost:3000")).toBe("localhost");
  });

  it("returns null for invalid origins", () => {
    expect(projectIdForOrigin("not a url")).toBeNull();
  });
});

describe("projectDisplayName", () => {
  it("prefixes domains with a wildcard", () => {
    expect(projectDisplayName("google.com")).toBe("*.google.com");
  });

  it("keeps non-domain ids as-is", () => {
    expect(projectDisplayName("localhost")).toBe("localhost");
  });

  it("round-trips hostnames", () => {
    expect(projectDisplayName(projectIdForHostname("api.google.com"))).toBe(
      "*.google.com"
    );
  });
});
