import { useId, type CSSProperties, type SVGAttributes } from "react";
import { resolveSkillVisual, type SkillIconName } from "../skills/skillVisuals";
import "./skillIcon.css";

interface SkillIconProps extends Omit<SVGAttributes<SVGSVGElement>, "role"> {
  abilityId: string;
  roleHint?: string;
  active?: boolean;
  decorative?: boolean;
  label?: string;
}

function IconPaths({ icon }: { icon: SkillIconName }) {
  switch (icon) {
    case "arcane_bolt":
      return <><path d="M33 5 21 25l10 2-6 32 22-35-12-2 9-17-11 12Z" /><path className="skill-icon-detail" d="m14 40 8-4m25-9 7-4M32 14l-4-8" /></>;
    case "iron_vow":
      return <><path d="M32 5 52 13v16c0 14-8 24-20 30C20 53 12 43 12 29V13l20-8Z" /><path className="skill-icon-cutout" d="m32 15 4 10 10 4-10 4-4 12-4-12-10-4 10-4 4-10Z" /><path className="skill-icon-detail" d="M18 16 32 10l14 6" /></>;
    case "far_mark":
      return <><circle cx="29" cy="34" r="17" /><circle className="skill-icon-cutout" cx="29" cy="34" r="9" /><path d="m18 47 27-27 2 7 11-16-16 10 7 2-27 27Z" /></>;
    case "ember_sigil":
      return <><path d="M34 5c3 12-8 14-3 24 4-4 7-8 7-13 9 8 14 16 12 26-2 11-10 17-19 17S13 52 13 41c0-9 6-15 14-22-1 8 2 11 7 14 4-10 5-18 0-28Z" /><path className="skill-icon-cutout" d="M32 33c6 7 7 11 4 17-2 4-9 4-11-1-2-5 2-10 7-16Z" /></>;
    case "mending_current":
      return <><path d="M32 5C23 18 15 27 15 39a17 17 0 0 0 34 0C49 27 41 18 32 5Z" /><path className="skill-icon-cutout" d="M28 26h8v9h9v8h-9v9h-8v-9h-9v-8h9v-9Z" /></>;
    case "echo_companion":
      return <><path d="m10 42 7-25 11 8 4-18 6 18 11-8 5 25-9 15H19L10 42Z" /><path className="skill-icon-cutout" d="m20 34 8 3-5 5-3-8Zm24 0-8 3 5 5 3-8ZM28 49h8l-4 5-4-5Z" /></>;
    case "shield_bash":
      return <><path d="M10 14 33 5l21 10-3 25c-3 10-10 16-19 20-10-4-17-10-20-20l-2-26Z" /><path className="skill-icon-cutout" d="m23 18 9 8 9-8-4 12 9 8-11-3-3 14-3-14-11 3 9-8-4-12Z" /></>;
    case "whirlwind":
      return <><path d="M7 35c10-13 23-16 39-8l-6-10 17 11-14 11 4-8c-14-4-25-1-40 4Zm50-5C48 45 35 49 18 42l6 10L7 42l13-12-3 9c14 4 25 1 40-9Z" /><path className="skill-icon-detail" d="m26 35 9-9m-4 16 9-9" /></>;
    case "frost_nova":
      return <><path d="m29 4 6 0-1 19 10-10 4 4-11 11 20-1v7l-20-1 11 11-4 4-10-10 1 21h-6l1-21-11 10-4-4 11-11-20 1v-7l20 1-11-11 4-4 11 10-1-19Z" /><circle className="skill-icon-cutout" cx="32" cy="31" r="6" /></>;
    case "meteor":
      return <><path d="m9 7 29 22-7 7L9 7Zm10-2 24 21-5 4L19 5ZM7 18l21 22-5 5L7 18Z" /><path d="M51 29c8 8 7 19 0 26s-18 7-26-1l13-15 13-10Z" /><path className="skill-icon-cutout" d="m42 38 8 6-4 7-9-3 5-10Z" /></>;
    case "magic_barrier":
      return <><path d="m32 4 23 13v29L32 60 9 46V17L32 4Z" /><path className="skill-icon-cutout" d="m32 14 14 8v18l-14 9-14-9V22l14-8Z" /><path d="m32 20 8 14-8 9-8-9 8-14Z" /></>;
    case "blade":
    default:
      return <><path d="m48 5 8 8-29 34-11 3 3-11L48 5Z" /><path d="m17 43 9 9-8 8-9-9 8-8Z" /><path className="skill-icon-detail" d="M37 15 47 25M8 12l42 42" /></>;
  }
}

export function SkillIcon({
  abilityId,
  roleHint = "",
  active = false,
  decorative = true,
  label,
  className = "",
  style,
  ...svgProps
}: SkillIconProps) {
  const visual = resolveSkillVisual(abilityId, roleHint);
  const titleId = useId();
  const cssVariables = {
    ...style,
    "--skill-primary": visual.primary,
    "--skill-secondary": visual.secondary,
    "--skill-glow": visual.glow,
  } as CSSProperties;
  const accessibleLabel = label ?? abilityId.replaceAll("_", " ");

  return (
    <svg
      {...svgProps}
      viewBox="0 0 64 64"
      className={`skill-icon skill-icon--${visual.fxStyle}${active ? " is-active" : ""} ${className}`.trim()}
      style={cssVariables}
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : titleId}
      role={decorative ? undefined : "img"}
      focusable="false"
      data-skill-icon={visual.icon}
      data-fx-style={visual.fxStyle}
    >
      {!decorative && <title id={titleId}>{accessibleLabel}</title>}
      <rect className="skill-icon-backdrop" x="2" y="2" width="60" height="60" rx="13" />
      <g className="skill-icon-art"><IconPaths icon={visual.icon} /></g>
      <path className="skill-icon-sheen" d="M7 40 40 7h12L10 49Z" />
      <rect className="skill-icon-frame" x="2.75" y="2.75" width="58.5" height="58.5" rx="12" />
    </svg>
  );
}
