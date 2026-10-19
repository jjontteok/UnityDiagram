using UnityEngine;

public abstract class EntityBase : MonoBehaviour, IDamageable {
    [SerializeField] protected EntityData data;
    public abstract void TakeDamage(int amount);
}
