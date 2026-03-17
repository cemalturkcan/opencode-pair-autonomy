import type {
  AdapterAuthStateResult,
  AdapterInteractiveElementSummary,
  AdapterNetworkEntry
} from "./adapter.js";

export type AuthFrameInspection = {
  index: number;
  name?: string;
  url: string;
  title?: string;
  text: string;
  inputs: AdapterInteractiveElementSummary[];
  buttons: AdapterInteractiveElementSummary[];
};

type AuthDocumentInspection = {
  kind: "page" | "frame";
  url: string;
  title?: string;
  text: string;
  inputs: AdapterInteractiveElementSummary[];
  buttons: AdapterInteractiveElementSummary[];
  frame?: Pick<AuthFrameInspection, "index" | "name">;
};

type AuthStateClassification = Pick<
  AdapterAuthStateResult,
  "state" | "confidence" | "summary" | "evidence" | "suggestedSelectors"
>;

export function normalizeAuthText(text: string | undefined) {
  return text?.replace(/\s+/g, " ").trim() ?? "";
}

function toLowerText(text: string | undefined) {
  return normalizeAuthText(text).toLowerCase();
}

function getVisibleInputs(inputs: AdapterInteractiveElementSummary[]) {
  return inputs.filter((input) => input.visible !== false);
}

function getButtonTexts(buttons: AdapterInteractiveElementSummary[]) {
  return buttons
    .map((button) => normalizeAuthText(button.text))
    .filter((text): text is string => Boolean(text));
}

function isAppleAuthDocument(document: AuthDocumentInspection) {
  return /apple\.com/i.test(document.url) || /apple/i.test(document.title ?? "");
}

function hasVerificationCodeInputs(document: AuthDocumentInspection) {
  const visibleInputs = getVisibleInputs(document.inputs);
  const otpInputs = visibleInputs.filter((input) => {
    const autocomplete = input.autocomplete?.toLowerCase();
    const type = input.type?.toLowerCase();
    return (
      autocomplete === "one-time-code" ||
      type === "tel" ||
      type === "number" ||
      type === "otp" ||
      type === "text"
    );
  });

  return otpInputs.length >= 4;
}

function hasPhoneChallengeButtons(document: AuthDocumentInspection) {
  const buttonTexts = getButtonTexts(document.buttons);
  const maskedOptions = buttonTexts.filter((text) => /[•*x]/i.test(text) && /\b\d{2}\b/.test(text));
  const combined = toLowerText([document.text, ...buttonTexts].join(" "));

  return maskedOptions.length >= 2 && /(sms|text|telefon|phone|mesaj)/i.test(combined);
}

function isTrustPrompt(document: AuthDocumentInspection) {
  const combined = toLowerText([document.title, document.text, ...getButtonTexts(document.buttons)].join(" "));
  const hasTrustCopy =
    /trust this browser|bu tarayiciya guven|bu tarayıcıya güven|trusted browser/i.test(combined);
  const hasTrustButtons =
    /(guvenme|güvenme|simdi degil|şimdi değil|trust|don't trust|not now)/i.test(combined);

  return hasTrustCopy || (hasTrustButtons && /(guven|güven|trust)/i.test(combined));
}

function hasVisiblePasswordInput(document: AuthDocumentInspection) {
  return getVisibleInputs(document.inputs).some((input) => input.type?.toLowerCase() === "password");
}

function hasVisibleIdentityInput(document: AuthDocumentInspection) {
  return getVisibleInputs(document.inputs).some((input) => {
    const type = input.type?.toLowerCase();
    return type === "email" || type === "text" || type === "tel";
  });
}

function scoreAuthDocument(document: AuthDocumentInspection) {
  const text = toLowerText([document.title, document.text, ...getButtonTexts(document.buttons)].join(" "));
  let score = 0;

  if (hasVerificationCodeInputs(document)) {
    score += 8;
  }
  if (hasPhoneChallengeButtons(document)) {
    score += 7;
  }
  if (isTrustPrompt(document)) {
    score += 7;
  }
  if (hasVisiblePasswordInput(document)) {
    score += 6;
  }
  if (hasVisibleIdentityInput(document)) {
    score += 4;
  }
  if (/sign in|giris yap|giriş yap|apple developer/i.test(text)) {
    score += 2;
  }

  if (document.kind === "frame" && score > 0) {
    score += 1;
  }

  return score;
}

function pickPrimaryDocument(documents: AuthDocumentInspection[]) {
  if (documents.length === 0) {
    throw new Error("Expected at least one auth document to classify");
  }

  return [...documents].sort((left, right) => scoreAuthDocument(right) - scoreAuthDocument(left))[0] ?? documents[0]!;
}

function getSuggestedSelectors(state: AuthStateClassification["state"], document: AuthDocumentInspection) {
  const isApple = isAppleAuthDocument(document);
  const framePrefix = isApple && document.kind === "frame"
    ? "iframe#aid-auth-widget-iFrame >> internal:control=enter-frame >> "
    : "";

  switch (state) {
    case "verification_code":
      return isApple && document.kind === "frame"
        ? [
            `${framePrefix}input[autocomplete='one-time-code']`,
            `${framePrefix}input[inputmode='numeric']`,
            `${framePrefix}input[type='tel']`
          ]
        : ["input[autocomplete='one-time-code']", "input[inputmode='numeric']", "input[type='tel']"];
    case "phone_selection":
      return isApple && document.kind === "frame"
        ? [`${framePrefix}text=/SMS|Text|Phone|Telefon/`]
        : ["text=/SMS|Text|Phone|Telefon/"];
    case "trust_prompt":
      return isApple && document.kind === "frame"
        ? [`${framePrefix}text=/Trust|Güven|Guven/`]
        : ["text=/Trust|Güven|Guven/"];
    case "password_prompt":
      return isApple && document.kind === "frame"
        ? [`${framePrefix}#password_text_field`, `${framePrefix}input[type='password']`]
        : ["input[type='password']"];
    case "email_prompt":
      return isApple && document.kind === "frame"
        ? [`${framePrefix}#account_name_text_field`, `${framePrefix}input[type='email']`, `${framePrefix}input[type='text']`]
        : ["input[type='email']", "input[type='text']"];
    default:
      return [];
  }
}

export function classifyAuthStateSnapshot(input: {
  pageUrl: string;
  pageTitle?: string;
  pageText: string;
  pageInputs: AdapterInteractiveElementSummary[];
  pageButtons: AdapterInteractiveElementSummary[];
  frames: AuthFrameInspection[];
  recentNetwork: AdapterNetworkEntry[];
}): AuthStateClassification {
  const evidence: string[] = [];

  if (
    input.pageUrl.includes("developer.apple.com/account") ||
    input.recentNetwork.some(
      (entry) => entry.status === 200 && /developer\.apple\.com\/services-account\//i.test(entry.url)
    )
  ) {
    evidence.push("authenticated developer account endpoints loaded");
    return {
      state: "authenticated",
      confidence: "high",
      summary: "The authenticated destination page is loaded.",
      evidence,
      suggestedSelectors: []
    };
  }

  const documents: AuthDocumentInspection[] = [
    {
      kind: "page",
      url: input.pageUrl,
      title: input.pageTitle,
      text: input.pageText,
      inputs: input.pageInputs,
      buttons: input.pageButtons
    },
    ...input.frames.map((frame) => ({
      kind: "frame" as const,
      url: frame.url,
      title: frame.title,
      text: frame.text,
      inputs: frame.inputs,
      buttons: frame.buttons,
      frame: {
        index: frame.index,
        name: frame.name
      }
    }))
  ];
  const primary = pickPrimaryDocument(documents);
  const primaryText = toLowerText([primary.title, primary.text, ...getButtonTexts(primary.buttons)].join(" "));
  const networkText = input.recentNetwork.map((entry) => entry.url.toLowerCase()).join(" ");

  if (primary.kind === "frame") {
    evidence.push(`same-origin auth iframe inspected${primary.frame?.name ? ` (${primary.frame.name})` : ""}`);
  }

  if (isTrustPrompt(primary)) {
    evidence.push("browser trust prompt detected from live DOM");
    return {
      state: "trust_prompt",
      confidence: "high",
      summary: "The flow is asking whether this browser should be trusted.",
      evidence,
      suggestedSelectors: getSuggestedSelectors("trust_prompt", primary)
    };
  }

  if (
    hasPhoneChallengeButtons(primary) ||
    /telefon numarasi secin|telefon numarası seçin|which phone|receive the code|texted to|sms|phone number/i.test(primaryText)
  ) {
    evidence.push("phone challenge options detected from live DOM");
    return {
      state: "phone_selection",
      confidence: "high",
      summary: "The flow is asking which phone or delivery method should receive the code.",
      evidence,
      suggestedSelectors: getSuggestedSelectors("phone_selection", primary)
    };
  }

  if (
    hasVerificationCodeInputs(primary) ||
    /verification code|dogrulama kodu|doğrulama kodu|security code|enter the code|iki faktorlu|iki faktörlü/i.test(primaryText)
  ) {
    evidence.push("verification code step detected from live DOM");
    return {
      state: "verification_code",
      confidence: "high",
      summary: "The flow is waiting for a one-time verification code.",
      evidence,
      suggestedSelectors: getSuggestedSelectors("verification_code", primary)
    };
  }

  if (hasVisiblePasswordInput(primary) || /password|parola/i.test(primaryText)) {
    evidence.push("password prompt detected from live DOM");
    return {
      state: "password_prompt",
      confidence: hasVisiblePasswordInput(primary) ? "high" : "medium",
      summary: "The flow is asking for an account password.",
      evidence,
      suggestedSelectors: getSuggestedSelectors("password_prompt", primary)
    };
  }

  if (
    hasVisibleIdentityInput(primary) ||
    /email|e-posta|telefon|phone number|sign in|giris yap|giriş yap/i.test(primaryText)
  ) {
    evidence.push("identity prompt detected from live DOM");
    return {
      state: "email_prompt",
      confidence: hasVisibleIdentityInput(primary) ? "high" : "medium",
      summary: "The flow is asking for an email address or phone number.",
      evidence,
      suggestedSelectors: getSuggestedSelectors("email_prompt", primary)
    };
  }

  if (/verify\/phone|one-time-code|hsa2/i.test(networkText)) {
    evidence.push("verification code hints detected from recent network only");
    return {
      state: "verification_code",
      confidence: "low",
      summary: "The flow may be waiting for a one-time verification code.",
      evidence,
      suggestedSelectors: getSuggestedSelectors("verification_code", primary)
    };
  }

  if (/trusteddevice|trusted\/phone|sendcode|delivery/i.test(networkText)) {
    evidence.push("phone challenge hints detected from recent network only");
    return {
      state: "phone_selection",
      confidence: "low",
      summary: "The flow may be asking for a phone or code delivery method.",
      evidence,
      suggestedSelectors: getSuggestedSelectors("phone_selection", primary)
    };
  }

  return {
    state: "unknown",
    confidence: "low",
    summary: "The flow could not be classified from the current page and recent network activity.",
    evidence,
    suggestedSelectors: []
  };
}
