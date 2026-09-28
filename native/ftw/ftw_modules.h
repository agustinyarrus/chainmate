/*
 * The FreeType modules linked into ftw: what rendering a TrueType (variable) font takes.
 * The engine registers more drivers (CFF, Type 1, PCF…); none of them takes part in these glyphs.
 */
FT_USE_MODULE( FT_Module_Class, autofit_module_class )
FT_USE_MODULE( FT_Driver_ClassRec, tt_driver_class )
FT_USE_MODULE( FT_Module_Class, psnames_module_class )
FT_USE_MODULE( FT_Module_Class, sfnt_module_class )
FT_USE_MODULE( FT_Renderer_Class, ft_smooth_renderer_class )
