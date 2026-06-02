export const parse3dsMaxExport = (json: string): Record<string, [number, number][]>[] => {
    let result = '';
    let i = 0;
    const len = json.length;

    while (i < len) {
        if (json[i] === '{') {
            const keyCounts: Record<string, number> = {};
            result += '{';
            i++;

            while (i < len && json[i] !== '}') {
                if (json[i] !== '"') {
                    result += json[i];
                    i++;
                    continue;
                }

                // Extract key
                let key = '';
                i++;
                while (i < len && json[i] !== '"') {
                    key += json[i];
                    i++;
                }
                i++; // closing quote

                // Rename duplicates
                if (keyCounts[key] === undefined) {
                    keyCounts[key] = 0;
                    result += `"${key}"`;
                } else {
                    keyCounts[key]++;
                    result += `"${key}_${keyCounts[key]}"`;
                }

                // Copy colon
                while (i < len && json[i] !== ':') {
                    result += json[i];
                    i++;
                }
                result += ':';
                i++;

                // Copy value (bracket-balanced array)
                while (i < len && json[i] !== '[') {
                    result += json[i];
                    i++;
                }
                let depth = 0;
                do {
                    if (json[i] === '[') depth++;
                    else if (json[i] === ']') depth--;
                    result += json[i];
                    i++;
                } while (depth > 0 && i < len);
            }

            if (i < len) {
                result += '}';
                i++;
            }
        } else {
            result += json[i];
            i++;
        }
    }

    return JSON.parse(result);
};


export type ZoneFrames = Record<string, [number, number][]>[]

export const parse3DmaxZone = async (file: File): Promise<ZoneFrames> => {
    const text = await file.text()
    const cleanedText = text.endsWith(",") ? text.slice(0, -1) : text
    return parse3dsMaxExport(cleanedText)
}