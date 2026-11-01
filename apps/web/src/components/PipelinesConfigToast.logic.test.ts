import { describe, expect, it } from "vite-plus/test";

import { createPipelinesConfigToastFilter } from "./PipelinesConfigToast.logic";

describe("createPipelinesConfigToastFilter", () => {
  it("toasts a set of problems once, and again only after it changes or comes back", () => {
    const filter = createPipelinesConfigToastFilter();
    const broken = ["Pipeline 2: id is missing."];

    expect(filter(null)).toBe(null);
    expect(filter(broken)).toEqual(broken);
    expect(filter([...broken])).toBe(null);
    expect(filter(null)).toBe(null);
    expect(filter(broken)).toBe(null);
    expect(filter([])).toBe(null);
    expect(filter(broken)).toEqual(broken);
    expect(filter(["Pipeline 3: no stages."])).toEqual(["Pipeline 3: no stages."]);
  });
});
