declare module 'prismjs' {
  type PrismGrammar = object

  interface PrismStatic {
    languages: Record<string, PrismGrammar>
    highlight(code: string, grammar: PrismGrammar, language: string): string
  }

  const Prism: PrismStatic
  export default Prism
}

declare module 'prismjs/components/*'
