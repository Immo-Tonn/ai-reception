import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordInput } from "../PasswordInput";

const html = renderToStaticMarkup(
  createElement(PasswordInput, {
    label: "Пароль",
    name: "password",
    autoComplete: "current-password",
    showLabel: "Показати пароль",
    hideLabel: "Сховати пароль",
  }),
);

describe("PasswordInput (show/hide eye)", () => {
  it("starts hidden: type=password, toggle announces 'show' and is not pressed", () => {
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Показати пароль"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("keeps autocomplete / name so password managers and iOS autofill keep working", () => {
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain('name="password"');
  });

  it("the toggle is a plain button (never submits the form) and the label is bound to the input", () => {
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/<label[^>]*for="([^"]+)"[\s\S]*<input[^>]*id="\1"/);
  });

  it("the other languages exist for the toggle (DE/EN/UK/RU)", async () => {
    const { getMessages } = await import("@/lib/i18n");
    for (const locale of ["de", "en", "uk", "ru"] as const) {
      const { common } = getMessages(locale);
      expect(common.showPassword.length, locale).toBeGreaterThan(3);
      expect(common.hidePassword.length, locale).toBeGreaterThan(3);
      expect(common.showPassword).not.toBe(common.hidePassword);
    }
  });
});
