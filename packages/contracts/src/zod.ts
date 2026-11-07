import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Called once for the whole package; every schema module imports this file first.
extendZodWithOpenApi(z);
