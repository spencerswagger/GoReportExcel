package model

// BorderSidePatchJSON mirrors style.BorderSide for JSON style patches, so the
// model package does not need to import the style package.
type BorderSidePatchJSON struct {
	At    string `json:"at,omitempty"`
	Style string `json:"style"`
	Else  string `json:"else,omitempty"`
}

// BorderPatchJSON holds per-side border styling of a style patch.
type BorderPatchJSON struct {
	Top    *BorderSidePatchJSON `json:"top,omitempty"`
	Bottom *BorderSidePatchJSON `json:"bottom,omitempty"`
	Left   *BorderSidePatchJSON `json:"left,omitempty"`
	Right  *BorderSidePatchJSON `json:"right,omitempty"`
}

// FillPatchJSON is a solid cell fill of a style patch.
type FillPatchJSON struct {
	Color string `json:"color"`
}

// IndentPatchJSON sets cell indentation of a style patch.
type IndentPatchJSON struct {
	Expr  string `json:"expr,omitempty"`
	Value int    `json:"value,omitempty"`
}

// StylePatchJSON is a partial style applied by an override or a conditional
// format. It mirrors style.StyleSpec's JSON shape.
type StylePatchJSON struct {
	Border    *BorderPatchJSON `json:"border,omitempty"`
	Fill      *FillPatchJSON   `json:"fill,omitempty"`
	FontColor string           `json:"font_color,omitempty"`
	Bold      bool             `json:"bold,omitempty"`
	RowHeight float64          `json:"row_height,omitempty"`
	Indent    *IndentPatchJSON `json:"indent,omitempty"`
}
