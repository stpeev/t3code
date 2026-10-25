import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { questionCitationSourceId } from "../../lib/assistantTextSelection";
import { render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };

function Harness({ onCite }: { onCite: () => boolean }) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <div ref={setViewport}>
      <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
      {/* Timeline question rows are disclosure buttons that contain their own text. */}
      <div role="button" tabIndex={0}>
        <p data-assistant-citation-source={questionCitationSourceId("item-1")}>Incremental</p>
      </div>
    </div>
  );
}

it("cites text selected in a question card inside a disclosure row", async () => {
  const onCite = vi.fn(() => true);
  await using screen = await render(<Harness onCite={onCite} />, {
    // The toolbar reads no route state.
    router: false,
  });

  await userEvent.dblClick(screen.getByText(/Incremental/));
  // The toolbar portals to the document body, outside the render container.
  await userEvent.click(page.getByRole("button", { name: "Cite selection in composer" }));

  expect(onCite).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: "question:item-1", text: "Incremental" }),
    expect.anything(),
  );
});
