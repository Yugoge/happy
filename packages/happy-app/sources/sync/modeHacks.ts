export type HackableMode = {
    key: string;
    name: string;
    description?: string | null;
};

export function hackMode<T extends HackableMode>(mode: T): T {
    const normalizedName = mode.name.trim().toLowerCase();
    const normalizedKey = mode.key.trim().toLowerCase();

    if (normalizedKey === 'build' && (normalizedName === 'build' || normalizedName === 'build, build')) {
        return { ...mode, name: 'Build' };
    }
    if (normalizedKey === 'plan' && (normalizedName === 'plan' || normalizedName === 'plan/plan')) {
        return { ...mode, name: 'Plan' };
    }
    return mode;
}

export function hackModes<T extends HackableMode>(modes: T[]): T[] {
    return modes.map(hackMode);
}
