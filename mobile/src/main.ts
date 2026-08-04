import { mount } from 'svelte';

import App from './ui/App.svelte';
import './ui/estilo.css';

export default mount(App, { target: document.getElementById('app')! });
