<!-- ABOUTME: Root application component -->
<!-- ABOUTME: Wraps the main Chat component -->

<script>
  import Chat from './lib/Chat.svelte';
</script>

<main>
  <Chat />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, sans-serif;
  }

  main {
    width: 100%;
    height: 100vh;
  }
</style>
