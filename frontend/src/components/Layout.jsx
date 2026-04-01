import Header from './Header'

export default function Layout({ role, isConnected, storeInfo, onLogout, children }) {
  return (
    <div style={styles.container}>
      <Header
        role={role}
        isConnected={isConnected}
        storeInfo={storeInfo}
        onLogout={onLogout}
      />
      <main style={styles.main}>
        {children}
      </main>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    width: '100%',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    overflow: 'auto',
  },
}
