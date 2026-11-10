# Experimental presentation editor

The local-copy editor is guarded by an experimental build flag. Its scroll view
instantiates the fixed editing controls eagerly; the variable-length slide list
uses lazy layout. Performance with large real presentations has not been measured.

Color controls expose a separate accessibility label and value. VoiceOver and
large-text navigation have not been verified on Apple devices. The UI test checks
that the slide actions can be reached and retains a screenshot, but must pass on
Apple before this layout is considered validated. Slide media editing, complete
rendering, presentation mode and export are not covered by this experiment.
