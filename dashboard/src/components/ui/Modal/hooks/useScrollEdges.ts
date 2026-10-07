export type Scroll = {
  // How far the content has been scrolled.
  offset: number;
  // The height of all the content.
  content: number;
  // The height of the part that shows.
  view: number;
};

export type Edges = { above: boolean; below: boolean };

// Whether content is out of view above and below the part that shows.
export const useScrollEdges = (scroll: Scroll): Edges => ({
  above: scroll.offset > 0,
  below: scroll.offset + scroll.view < scroll.content - 1,
});
