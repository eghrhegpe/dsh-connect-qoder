// Can bare Node EXECUTE a .tsx (native JSX transform), with no bundler?
import { Fragment } from "react"
const el = (
  <Fragment>
    <span className="a">hi</span>
  </Fragment>
)
console.log("jsx-ok", typeof el, (el as { type?: unknown }).type === Fragment ? "fragment" : "?")
