import filmsData from "../data/films.json" with { type: "json" };
import { scoreFilms } from "../lib/scoring.js";
export const recommendFilms = {
    name: "recommend_films",
    descriptor: {
        title: "Recommend Window Films",
        description: "Returns the top 3 films based on property type and goals.",
        inputSchema: {
            property_type: "residential|commercial",
            goals: ["heat", "glare", "uv", "privacy", "security", "decorative"],
            city: "optional",
            sun_exposure: "optional(low|medium|high)",
            application: { type: "string", enum: ["living_room", "bedroom", "kitchen", "bathroom", "office", "conference_room", "storefront", "lobby", "server_room", "warehouse", "other"] },
            vlt_preference: { type: "string", enum: ["brighter", "neutral", "darker"] },
            budget_level: { type: "string", enum: ["value", "mid", "premium"] },
            install_location: { type: "string", enum: ["interior", "exterior"] },
            orientation: { type: "string", enum: ["north", "east", "south", "west"] }
        }
    },
    handler: async (input) => {
        const films = Array.isArray(filmsData) ? filmsData : (filmsData.films ?? []);
        const { property_type, goals } = input;
        // ask for missing fields to increase recommendation accuracy
        const missing = [];
        if (!input.application)
            missing.push("application (e.g., living_room, office)");
        if (!input.vlt_preference)
            missing.push("brightness preference (brighter/neutral/darker)");
        if (!input.budget_level)
            missing.push("budget (value/mid/premium)");
        if (!input.install_location)
            missing.push("install location (interior/exterior)");
        if (!input.sun_exposure && !input.orientation)
            missing.push("sun exposure or orientation");
        if (missing.length) {
            return {
                content: [{ type: "text", text: `To dial this in, tell me: ${missing.join(", ")}.` }],
                structuredContent: { recommendations: [] }
            };
        }
        const recs = scoreFilms(films, { property_type, goals });
        return {
            content: [{ type: "text", text: `Top picks for ${property_type} based on ${goals.join(", ")}:` }],
            structuredContent: { recommendations: recs }
        };
    }
};
