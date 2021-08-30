import reducers from 'redux/core/reducers'


const show = (isVisible, text, txId) => reducers.loader.setVisibility({ isVisible, text, txId })
const hide = () => reducers.loader.setVisibility({})


export default {
  show,
  hide,
}
