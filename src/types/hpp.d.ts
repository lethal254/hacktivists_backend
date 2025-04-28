declare module "hpp" {
  import { RequestHandler } from "express"
  const hpp: () => RequestHandler
  export default hpp
}
