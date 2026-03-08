from scipy.spatial import KDTree
import numpy as np

def build_spatial_index(debris_data):
    """
    Creates a KD-Tree for all debris positions.
    debris_data: List of position vectors [[x,y,z], ...]
    """
    if not debris_data:
        return None
    return KDTree(np.array(debris_data))

def find_nearby_threats(tree, sat_pos, radius=0.5):
    """
    Returns indices of debris within the danger radius (km).
    """
    if tree is None:
        return []
    return tree.query_ball_point(sat_pos, radius)