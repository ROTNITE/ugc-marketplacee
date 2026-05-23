"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate } from "../ui";

type Profile = {
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  socialLinks: Record<string, string>;
  niches: string[];
  languages: string[];
  regions: string[];
  platforms: string[];
  audienceSize: number | null;
  audienceAgeMin: number | null;
  audienceAgeMax: number | null;
};

const socialFields = ["youtube", "tiktok", "instagram", "vk", "telegram", "website"];
const platformFields = ["youtube", "tiktok", "instagram", "vk", "telegram", "website"];
const languageFields = ["ru", "en", "both"];

export default function ProfilePage() {
  const auth = useAuth();
  const { t } = useI18n();
  const [profile, setProfile] = useState<Profile>({
    displayName: "",
    avatarUrl: "",
    bio: "",
    socialLinks: {},
    niches: [],
    languages: [],
    regions: [],
    platforms: [],
    audienceSize: null,
    audienceAgeMin: null,
    audienceAgeMax: null
  });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auth.accessToken) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    apiRequest<{ profile: Profile }>("/profiles/me", { method: "GET" }, auth.accessToken)
      .then((payload) => setProfile(normalizeProfile(payload.profile)))
      .catch((caught) =>
        setStatus(caught instanceof Error ? caught.message : "LOAD_FAILED")
      )
      .finally(() => setLoading(false));
  }, [auth.accessToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    try {
      const payload = await apiRequest<{ profile: Profile }>(
        "/profiles/me",
        {
          body: JSON.stringify({
            ...profile,
            avatarUrl: profile.avatarUrl || null
          }),
          method: "PUT"
        },
        auth.accessToken
      );
      setProfile(normalizeProfile(payload.profile));
      setStatus("profile.saved");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "SAVE_FAILED");
    }
  }

  if (auth.loading || loading) {
    return <main className="auth-shell">{t("profile.loading")}</main>;
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.login")}
        title={t("error.UNAUTHORIZED")}
        message={t("profile.unauthorized")}
      />
    );
  }

  return (
    <main className="auth-shell">
      <form className="panel form" onSubmit={submit}>
        <p className="eyebrow">
          {auth.user.role === "creator" ? t("profile.creator") : t("profile.brand")}
        </p>
        <h1>
          {auth.user.role === "creator"
            ? t("profile.creatorDetails")
            : t("profile.brandDetails")}
        </h1>
        <label>
          {auth.user.role === "creator"
            ? t("profile.displayName")
            : t("profile.brandName")}
          <input
            maxLength={120}
            onChange={(event) =>
              setProfile((current) => ({ ...current, displayName: event.target.value }))
            }
            required
            value={profile.displayName}
          />
        </label>
        <label>
          {t("profile.avatarUrl")}
          <input
            onChange={(event) =>
              setProfile((current) => ({ ...current, avatarUrl: event.target.value }))
            }
            placeholder="https://example.com/avatar.jpg"
            type="url"
            value={profile.avatarUrl ?? ""}
          />
        </label>
        <label>
          {t("profile.bio")}
          <textarea
            maxLength={500}
            onChange={(event) =>
              setProfile((current) => ({ ...current, bio: event.target.value }))
            }
            rows={5}
            value={profile.bio}
          />
        </label>
        <fieldset>
          <legend>{t("profile.socialLinks")}</legend>
          {socialFields.map((field) => (
            <label key={field}>
              {field}
              <input
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    socialLinks: {
                      ...current.socialLinks,
                      [field]: event.target.value
                    }
                  }))
                }
                placeholder={`https://${field}.com/...`}
                type="url"
                value={profile.socialLinks[field] ?? ""}
              />
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t("profile.matching")}</legend>
          <label>
            {t("profile.niches")}
            <input
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  niches: fromCsv(event.target.value)
                }))
              }
              placeholder="gaming, apps"
              value={toCsv(profile.niches)}
            />
          </label>
          <label>
            {t("profile.regions")}
            <input
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  regions: fromCsv(event.target.value)
                }))
              }
              placeholder="cis, moscow"
              value={toCsv(profile.regions)}
            />
          </label>
          <div className="checkbox-grid">
            {languageFields.map((language) => (
              <label className="choice" key={language}>
                <input
                  checked={profile.languages.includes(language)}
                  onChange={() => toggleListValue("languages", language)}
                  type="checkbox"
                />
                {language}
              </label>
            ))}
          </div>
          <div className="checkbox-grid">
            {platformFields.map((platform) => (
              <label className="choice" key={platform}>
                <input
                  checked={profile.platforms.includes(platform)}
                  onChange={() => toggleListValue("platforms", platform)}
                  type="checkbox"
                />
                {platform}
              </label>
            ))}
          </div>
          <div className="field-row">
            <label>
              {t("profile.audienceSize")}
              <input
                min="0"
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    audienceSize: toOptionalNumber(event.target.value)
                  }))
                }
                type="number"
                value={profile.audienceSize ?? ""}
              />
            </label>
            <label>
              {t("profile.ageMin")}
              <input
                min="1"
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    audienceAgeMin: toOptionalNumber(event.target.value)
                  }))
                }
                type="number"
                value={profile.audienceAgeMin ?? ""}
              />
            </label>
            <label>
              {t("profile.ageMax")}
              <input
                min="1"
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    audienceAgeMax: toOptionalNumber(event.target.value)
                  }))
                }
                type="number"
                value={profile.audienceAgeMax ?? ""}
              />
            </label>
          </div>
        </fieldset>
        {status ? (
          <p className={status === "profile.saved" ? undefined : "error"}>{t(status)}</p>
        ) : null}
        <div className="actions">
          <button type="submit">{t("profile.save")}</button>
          <Link href="/">{t("nav.backHome")}</Link>
        </div>
      </form>
    </main>
  );

  function toggleListValue(field: "languages" | "platforms", value: string) {
    setProfile((current) => {
      const values = current[field];
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];

      return { ...current, [field]: next };
    });
  }
}

function normalizeProfile(profile: Profile): Profile {
  return {
    ...profile,
    avatarUrl: profile.avatarUrl ?? "",
    niches: profile.niches ?? [],
    languages: profile.languages ?? [],
    regions: profile.regions ?? [],
    platforms: profile.platforms ?? [],
    audienceSize: profile.audienceSize ?? null,
    audienceAgeMin: profile.audienceAgeMin ?? null,
    audienceAgeMax: profile.audienceAgeMax ?? null
  };
}

function fromCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function toCsv(values: string[]): string {
  return values.join(", ");
}

function toOptionalNumber(value: string): number | null {
  return value ? Number(value) : null;
}
