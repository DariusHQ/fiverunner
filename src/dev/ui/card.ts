/** An element of an adaptive card, as far as the dev UI reads it. */
interface CardElement {
  readonly type?: string
  readonly id?: string
  readonly text?: string
  readonly title?: string
  readonly placeholder?: string
  readonly value?: string
  readonly valueOn?: string
  readonly valueOff?: string
  readonly size?: string
  readonly weight?: string
  readonly isMultiline?: boolean
  readonly choices?: readonly { readonly title: string; readonly value: string }[]
  readonly items?: readonly CardElement[]
  readonly columns?: readonly CardElement[]
  readonly body?: readonly CardElement[]
  readonly actions?: readonly CardElement[]
  readonly data?: Readonly<Record<string, unknown>>
}

/** What the inputs of a card answer with, by their ids. */
type Inputs = Map<string, () => string>

function labelled(text: string, control: HTMLElement): HTMLElement {
  const label = document.createElement('label')
  label.append(control, text)
  return label
}

/** The elements that show `element`, adding its inputs to `inputs`, or undefined if the dev UI does not know it. */
function elementsOf(element: CardElement, inputs: Inputs): HTMLElement[] | undefined {
  switch (element.type) {
    case 'TextBlock': {
      const text = document.createElement('p')
      text.textContent = element.text ?? ''
      text.classList.toggle('large', /large/i.test(element.size ?? ''))
      text.classList.toggle('bold', element.weight === 'Bolder')
      return [text]
    }
    case 'Input.Text':
    case 'Input.Number': {
      const input = document.createElement(element.isMultiline ? 'textarea' : 'input')
      input.placeholder = element.placeholder ?? ''
      input.value = element.value ?? ''
      input.ariaLabel = element.placeholder ?? element.id ?? ''
      inputs.set(element.id ?? '', () => input.value)
      return [input]
    }
    case 'Input.Toggle': {
      const input = document.createElement('input')
      input.type = 'checkbox'
      const on = element.valueOn ?? 'true'
      input.checked = element.value === on
      inputs.set(element.id ?? '', () => (input.checked ? on : (element.valueOff ?? 'false')))
      return [labelled(element.title ?? '', input)]
    }
    case 'Input.ChoiceSet': {
      const select = document.createElement('select')
      select.ariaLabel = element.id ?? ''
      for (const { title, value } of element.choices ?? []) {
        select.add(new Option(title, value))
      }
      select.value = element.value ?? select.value
      inputs.set(element.id ?? '', () => select.value)
      return [select]
    }
    case 'Container':
    case 'Column':
      return allOf(element.items ?? [], inputs)
    case 'ColumnSet':
      return allOf(element.columns ?? [], inputs)
    default:
      return undefined
  }
}

function allOf(elements: readonly CardElement[], inputs: Inputs): HTMLElement[] | undefined {
  const shown = elements.map((element) => elementsOf(element, inputs))
  return shown.every((each) => each !== undefined) ? shown.flat() : undefined
}

/**
 * The form of an adaptive card, whose actions call `submit` with what it
 * answers, as FiveM's loading screen does: its inputs and the data of the
 * action, as JSON. Undefined for a card with what the dev UI does not know.
 */
export function cardForm(json: string, submit: (answer: string) => void): HTMLElement | undefined {
  let card: CardElement
  try {
    card = JSON.parse(json) as CardElement
  } catch {
    return undefined
  }
  const inputs: Inputs = new Map()
  const body = allOf(card.body ?? [], inputs)
  if (body === undefined) return undefined
  const form = document.createElement('form')
  form.className = 'adaptive'
  form.addEventListener('submit', (event) => event.preventDefault())
  form.append(...body)
  for (const action of card.actions ?? []) {
    if (action.type !== 'Action.Submit') return undefined
    const button = document.createElement('button')
    button.textContent = action.title ?? 'Submit'
    button.addEventListener('click', () => {
      const answers = Object.fromEntries([...inputs].map(([id, value]) => [id, value()]))
      const id = action.id === undefined ? {} : { submitId: action.id }
      submit(JSON.stringify({ ...answers, ...action.data, ...id }))
    })
    form.append(button)
  }
  return form
}
